// 因 Tauri Linux 的 WebKitGTK 不派发 HTML5 DnD 的 dragover/drop，故改用 pointerdown + window 级指针事件实现拖拽

import { onUnmounted, ref } from 'vue'
import type { Editor } from '@prosekit/core'
import type { Ref } from 'vue'
import { NodeSelection } from 'prosekit/pm/state'
import { getVisibleBlockRect, getView, layoutToViewportSize, layoutToViewportX, layoutToViewportY } from './blockHandleUtils'
import type { HoveredBlock } from './useHoverState'

interface DragSource {
  editor: Editor
  node: any
  from: number
  to: number
  handled?: boolean
}

interface EditorHit {
  editor: Editor
  pm: HTMLElement
  x: number
  y: number
}

interface DropAnchor {
  pos: number
  el: HTMLElement | null
  before: boolean
}

export function useBlockDrag(options: {
  editor: Editor | null
  hoveredBlock: Ref<HoveredBlock | null>
  suppressUI: () => void
}) {
  const { editor, hoveredBlock, suppressUI } = options
  const view = () => getView(editor)

  // 因行高亮会与 NodeSelection 选区框重叠，故拖拽期间隐藏
  const isDragging = ref(false)
  let active = false
  let source: DragSource | null = null
  let ghostEl: HTMLElement | null = null
  let indicatorEl: HTMLElement | null = null
  // 因落点/指示器计算较重，故用 rAF 合并到每帧一次
  let rafId = 0
  let lastX = 0
  let lastY = 0
  let needsIndicator = false
  const SCROLL_EDGE = 48
  const SCROLL_MAX_SPEED = 28

  function editorOfPm(pm: HTMLElement): Editor | null {
    let comp = (pm as any).__vueParentComponent
    while (comp) {
      if (comp.setupState && comp.setupState.editor) return comp.setupState.editor as Editor
      comp = comp.parent
    }
    return null
  }

  const clampTo = (min: number, max: number, value: number) => Math.min(Math.max(value, min), max)

  // 因 gutter 是 pointer-events:none 的留白、手柄正落在其中，故未直接命中时按 wrapper 盒子兜底并夹回落点
  // （布局坐标与视口坐标需先经 layoutToViewport* 换算）
  function resolveEditorHit(x: number, y: number): EditorHit | null {
    const direct = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.('.ProseMirror') as HTMLElement | null
    const directEditor = direct ? editorOfPm(direct) : null
    if (direct && directEditor) return { editor: directEditor, pm: direct, x, y }

    const pms = Array.from(document.querySelectorAll<HTMLElement>('.ProseMirror'))
    const pm = pms.find((el) => {
      const wrapper = el.closest('.editor-wrapper') as HTMLElement | null
      if (!wrapper) return false
      const r = wrapper.getBoundingClientRect()
      const left = layoutToViewportX(el, r.left)
      const right = layoutToViewportX(el, r.left + r.width)
      const top = layoutToViewportY(el, r.top)
      const bottom = layoutToViewportY(el, r.top + r.height)
      return x >= left && x <= right && y >= top && y <= bottom
    })
    const editor = pm ? editorOfPm(pm) : null
    if (!pm || !editor) return null
    const content = pm.getBoundingClientRect()
    return {
      editor,
      pm,
      x: clampTo(layoutToViewportX(pm, content.left) + 1, layoutToViewportX(pm, content.left + content.width) - 1, x),
      y: clampTo(layoutToViewportY(pm, content.top), layoutToViewportY(pm, content.top + content.height), y),
    }
  }

  function autoScroll(x: number, y: number, hit: EditorHit | null): boolean {
    const el = document.elementFromPoint(x, y)
    const scrollEl = (el?.closest?.('.editor-scroll') as HTMLElement | null) ?? ((hit?.pm.closest('.editor-scroll') as HTMLElement | null) ?? null)
    if (!scrollEl) return false
    // 因 gutter 内同样命不中滚动容器，故经编辑器归属兜底
    const r = scrollEl.getBoundingClientRect()
    const top = hit ? layoutToViewportY(hit.pm, r.top) : r.top
    const bottom = hit ? layoutToViewportY(hit.pm, r.top + r.height) : r.bottom
    const inTop = y > top && y < top + SCROLL_EDGE
    const inBottom = y < bottom && y > bottom - SCROLL_EDGE
    if (!inTop && !inBottom) return false
    const dist = inTop ? y - top : bottom - y
    const step = Math.max(2, Math.round(SCROLL_MAX_SPEED * (1 - dist / SCROLL_EDGE)))
    if (inTop && scrollEl.scrollTop > 0) {
      scrollEl.scrollTop -= step
      return true
    }
    if (inBottom && scrollEl.scrollTop < scrollEl.scrollHeight - scrollEl.clientHeight) {
      scrollEl.scrollTop += step
      return true
    }
    return false
  }

  // 拖到画布边缘经 Mindrizzle:canvas-pan 事件驱动画布平移
  const CANVAS_PAN_EDGE = 60
  const CANVAS_PAN_MAX = 8
  function panCanvas(x: number, y: number): boolean {
    const canvasEl = document.querySelector('.canvas-container') as HTMLElement | null
    if (!canvasEl) return false
    const r = canvasEl.getBoundingClientRect()
    let dx = 0
    let dy = 0
    if (x < r.left + CANVAS_PAN_EDGE) dx = Math.min(r.left + CANVAS_PAN_EDGE - x, CANVAS_PAN_MAX)
    else if (x > r.right - CANVAS_PAN_EDGE) dx = -Math.min(x - (r.right - CANVAS_PAN_EDGE), CANVAS_PAN_MAX)
    if (y < r.top + CANVAS_PAN_EDGE) dy = Math.min(r.top + CANVAS_PAN_EDGE - y, CANVAS_PAN_MAX)
    else if (y > r.bottom - CANVAS_PAN_EDGE) dy = -Math.min(y - (r.bottom - CANVAS_PAN_EDGE), CANVAS_PAN_MAX)
    if (!dx && !dy) return false
    window.dispatchEvent(new CustomEvent('Mindrizzle:canvas-pan', { detail: { dx, dy } }))
    return true
  }

  // 因每帧重算会卡顿，故自动滚动/平移每帧检查，落点/指示器仅在鼠标移动或内容滚动时重算
  function ensureDragLoop() {
    if (rafId) return
    rafId = requestAnimationFrame(dragLoop)
  }
  function dragLoop() {
    rafId = 0
    if (!active || !source) return
    // 本帧只解析一次鼠标下的编辑器
    const hit = resolveEditorHit(lastX, lastY)
    const scrolled = autoScroll(lastX, lastY, hit)
    const panned = panCanvas(lastX, lastY)
    if (needsIndicator || scrolled || panned) {
      needsIndicator = false
      if (hit) updateIndicator(hit.editor.view, resolveDropAnchor(hit.pm, hit.editor.view, hit.x, hit.y))
      else hideIndicator()
    }
    ensureDragLoop()
  }

  function onDragPointerDown(e: PointerEvent) {
    const v = view()
    const block = hoveredBlock.value
    const node = block?.node as any
    if (!v || !block || !node) return
    e.preventDefault()
    e.stopPropagation()
    // 与点击手柄一致：拖拽也应选中该块
    try {
      const sel = NodeSelection.create(v.state.doc, block.pos)
      v.dispatch(v.state.tr.setSelection(sel))
    } catch {
      /* noop */
    }

    source = { editor: editor as Editor, node, from: block.pos, to: block.pos + node.nodeSize }
    active = true
    isDragging.value = true
    // 跨编辑器全局抑制 popup/高亮
    document.body.classList.add('block-handle-dragging')
    suppressUI()
    createGhost(node, e.clientX, e.clientY)
    lastX = e.clientX
    lastY = e.clientY
    ensureDragLoop()
    // 因部分环境 mouse.down 后不派发 mousemove，故同时监听 pointermove；又因 hover 自解析会 stopPropagation，故用捕获阶段
    window.addEventListener('pointermove', onDragMove, true)
    window.addEventListener('mousemove', onDragMove, true)
    window.addEventListener('mouseup', onDragUp)
    window.addEventListener('pointerup', onDragUp)
  }

  function onDragMove(e: MouseEvent) {
    if (!active || !source) return
    // 因伪 pointermove 坐标是 -9999，故不能当作指针位置
    if (!e.isTrusted) return
    if (ghostEl) {
      ghostEl.style.left = `${e.clientX + 10}px`
      ghostEl.style.top = `${e.clientY + 10}px`
    }
    lastX = e.clientX
    lastY = e.clientY
    needsIndicator = true
    ensureDragLoop()
  }

  function onDragUp(e: MouseEvent) {
    if (!active || !source || source.handled) return
    source.handled = true
    try {
      const hit = resolveEditorHit(e.clientX, e.clientY)
      if (hit) {
        if (hit.editor === source.editor) moveInSameEditor(source, hit)
        else moveAcrossEditors(source, hit)
      }
    } finally {
      cleanup()
    }
  }

  // 用命中块元素经 posAtDOM 映射回文档位置（与坐标无关），再按鼠标 y 与块视觉中心比较取前/后
  function resolveDropAnchor(pm: HTMLElement, v: any, x: number, y: number): DropAnchor {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null
    let el: HTMLElement | null = hit && pm.contains(hit) ? hit : null
    while (el && el.parentElement !== pm) el = el.parentElement
    if (!el) return { pos: v.state.doc.content.size, el: null, before: false }
    const at = v.posAtDOM(el, 0)
    const $pos = v.state.doc.resolve(at)
    const rect = getVisibleBlockRect(el)
    const mid = rect ? layoutToViewportY(v, rect.top) + layoutToViewportSize(v, rect.height) / 2 : y
    const before = y < mid
    // 因原子块的 $pos.depth 为 0，故需按 nodeSize 取前后
    if ($pos.depth === 0) {
      const node = v.state.doc.nodeAt(at)
      return { pos: before ? at : at + (node?.nodeSize ?? 0), el, before }
    }
    return { pos: before ? $pos.before($pos.depth) : $pos.after($pos.depth), el, before }
  }

  function clampRange(view: any, from: number, to: number) {
    const max = view.state.doc.content.size
    const start = clampTo(0, max, from)
    const end = clampTo(start, max, to)
    if (end <= start) return null
    return { from: start, to: end }
  }

  // 因删除源块后插入位置会偏移，故经 tr.mapping 修正
  function moveInSameEditor(s: DragSource, hit: EditorHit) {
    const v = hit.editor.view
    const anchor = resolveDropAnchor(hit.pm, v, hit.x, hit.y)
    const range = clampRange(v, s.from, s.to)
    if (!range) return

    const tr = v.state.tr
    tr.delete(range.from, range.to)
    const insertPos = tr.mapping.map(anchor.pos)
    if (insertPos < 0 || insertPos > v.state.doc.content.size) return
    tr.insert(insertPos, v.state.schema.nodeFromJSON(s.node.toJSON()))
    v.dispatch(tr)
    v.focus()
  }

  function moveAcrossEditors(s: DragSource, hit: EditorHit) {
    const tgtView = hit.editor.view
    const anchor = resolveDropAnchor(hit.pm, tgtView, hit.x, hit.y)
    const srcView = s.editor.view
    const srcRange = clampRange(srcView, s.from, s.to)
    if (!srcRange) return

    const delTr = srcView.state.tr
    delTr.delete(srcRange.from, srcRange.to)
    srcView.dispatch(delTr)
    // 因各 editor 的 schema 独立，故经 nodeFromJSON 转换后插入
    const targetNode = tgtView.state.schema.nodeFromJSON(s.node.toJSON())
    const insTr = tgtView.state.tr
    const insertPos = clampTo(0, tgtView.state.doc.content.size, anchor.pos)
    insTr.insert(insertPos, targetNode)
    tgtView.dispatch(insTr)
    tgtView.focus()
  }

  function cleanup() {
    if (!active) return
    active = false
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    isDragging.value = false
    document.body.classList.remove('block-handle-dragging')
    source = null
    removeGhost()
    removeIndicator()
    window.removeEventListener('pointermove', onDragMove, true)
    window.removeEventListener('mousemove', onDragMove, true)
    window.removeEventListener('mouseup', onDragUp)
    window.removeEventListener('pointerup', onDragUp)
  }

  function createGhost(node: any, x: number, y: number) {
    removeGhost()
    ghostEl = document.createElement('div')
    ghostEl.style.cssText = [
      'position:fixed;pointer-events:none;z-index:9999;',
      'background:transparent;',
      'outline:2px solid #8cf;',
      'padding:3px 10px;',
      'max-width:280px;',
      'white-space:pre-wrap;',
      'word-break:break-word;',
      'overflow:hidden;',
      'box-sizing:border-box;',
    ].join('')
    ghostEl.textContent = node.textContent || ' '
    document.body.appendChild(ghostEl)
    ghostEl.style.left = `${x + 12}px`
    ghostEl.style.top = `${y + 12}px`
  }
  function removeGhost() {
    ghostEl?.remove()
    ghostEl = null
  }

  // 因 coordsAtPos 在 zoom 下拿的是布局坐标会偏移，故按块元素视觉矩形取上/下边缘
  function updateIndicator(v: any, anchor: DropAnchor) {
    if (!indicatorEl) {
      indicatorEl = document.createElement('div')
      indicatorEl.style.cssText =
        'position:fixed;pointer-events:none;height:2px;' +
        'background:rgba(var(--v-theme-primary),0.9);z-index:9998;left:0;top:0;'
      document.body.appendChild(indicatorEl)
    }
    const pmRect = v.dom.getBoundingClientRect()
    let y = layoutToViewportY(v, pmRect.top + pmRect.height)
    if (anchor.el) {
      const r = getVisibleBlockRect(anchor.el)
      if (r) y = anchor.before ? layoutToViewportY(v, r.top) : layoutToViewportY(v, r.top + r.height)
    }
    indicatorEl.style.display = 'block'
    indicatorEl.style.width = `${Math.max(2, Math.round(layoutToViewportSize(v, pmRect.width)))}px`
    indicatorEl.style.transform = `translate(${Math.round(layoutToViewportX(v, pmRect.left))}px, ${Math.round(y - 1)}px)`
  }
  function hideIndicator() {
    if (indicatorEl) indicatorEl.style.display = 'none'
  }
  function removeIndicator() {
    indicatorEl?.remove()
    indicatorEl = null
  }

  onUnmounted(cleanup)

  return { isDragging, onDragPointerDown }
}
