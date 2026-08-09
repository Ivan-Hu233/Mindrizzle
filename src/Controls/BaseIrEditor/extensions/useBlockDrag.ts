// 自定义指针拖拽：Tauri Linux 的 WebKitGTK 对 HTML5 DnD 支持不完整
// （dragover/drop 事件不派发），故完全不依赖 HTML5 DnD，改用
// pointerdown + window 级 pointermove/pointerup 完成拖拽、指示器与插入。

import { onUnmounted, ref } from 'vue'
import type { Editor } from '@prosekit/core'
import type { Ref } from 'vue'
import { NodeSelection } from 'prosekit/pm/state'
import { getView } from './blockHandleUtils'
import type { HoveredBlock } from './useHoverState'

interface DragSource {
  editor: Editor
  node: any
  from: number
  to: number
}

export function useBlockDrag(options: {
  editor: Editor | null
  hoveredBlock: Ref<HoveredBlock | null>
  suppressUI: () => void
}) {
  const { editor, hoveredBlock, suppressUI } = options
  const view = () => getView(editor)

  // 因拖拽中行高亮会与 NodeSelection 选区框重叠，故拖拽期间隐藏
  const isDragging = ref(false)
  let active = false
  let source: DragSource | null = null
  let ghostEl: HTMLElement | null = null
  let indicatorEl: HTMLElement | null = null
  // 因「落点/指示器」计算较重（elementFromPoint + posAtCoords + getBoundingClientRect）、
  // 每次 mousemove 都触发会卡顿，故用 rAF 合并到每帧最多一次
  let rafId = 0
  let lastX = 0
  let lastY = 0
  let needsIndicator = false
  // 因拖到滚动区上下边缘需自动滚动，故定义边缘带宽度与最大每帧滚动像素
  const SCROLL_EDGE = 48
  const SCROLL_MAX_SPEED = 28

  function findEditorAt(x: number, y: number): Editor | null {
    const el = document.elementFromPoint(x, y)
    if (!el?.closest) return null
    const pm = el.closest('.ProseMirror')
    if (!pm) return null
    let comp = (pm as any).__vueParentComponent
    while (comp) {
      if (comp.setupState && comp.setupState.editor) return comp.setupState.editor as Editor
      comp = comp.parent
    }
    return null
  }

  function findScrollElAt(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y)
    if (!el?.closest) return null
    return el.closest('.editor-scroll') as HTMLElement | null
  }

  function autoScroll(x: number, y: number): boolean {
    const scrollEl = findScrollElAt(x, y)
    if (!scrollEl) return false
    const r = scrollEl.getBoundingClientRect()
    const inTop = y > r.top && y < r.top + SCROLL_EDGE
    const inBottom = y < r.bottom && y > r.bottom - SCROLL_EDGE
    if (!inTop && !inBottom) return false
    // 越贴近边缘滚得越快
    const dist = inTop ? y - r.top : r.bottom - y
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

  // 因拖到画布边缘需画布自动平移（鼠标靠上/左边缘时内容向下/右移露出上方/左侧），
  // 故经 omnijot:canvas-pan 事件驱动 Editor.vue 的 pan
  const CANVAS_PAN_EDGE = 60 // 距画布视口边缘多少 px 触发
  const CANVAS_PAN_MAX = 8 // 每帧最大平移 px
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
    window.dispatchEvent(new CustomEvent('omnijot:canvas-pan', { detail: { dx, dy } }))
    return true
  }

  // 因每帧 posAtCoords 重算会卡顿，故自动滚动/平移每帧检查、落点/指示器仅在鼠标移动或内容滚动变化时重算
  function ensureDragLoop() {
    if (rafId) return
    rafId = requestAnimationFrame(dragLoop)
  }
  function dragLoop() {
    rafId = 0
    if (!active || !source) return
    const scrolled = autoScroll(lastX, lastY)
    const panned = panCanvas(lastX, lastY)
    if (needsIndicator || scrolled || panned) {
      needsIndicator = false
      updateDropIndicator(lastX, lastY)
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
    // 因拖拽也应选中该块（与点击手柄一致），故 pointerdown 时设置 NodeSelection
    try {
      const sel = NodeSelection.create(v.state.doc, block.pos)
      v.dispatch(v.state.tr.setSelection(sel))
    } catch {
      /* noop */
    }

    source = { editor: editor as Editor, node, from: block.pos, to: block.pos + node.nodeSize }
    active = true
    isDragging.value = true
    document.body.classList.add('block-handle-dragging') // 因需跨编辑器全局抑制 popup/高亮，故置 body 拖拽类
    suppressUI()
    createGhost(node, e.clientX, e.clientY)
    lastX = e.clientX
    lastY = e.clientY
    ensureDragLoop()
    // 因 mouse.down 后部分环境不再派发 mousemove，故同时监听 pointermove 以保证拖拽跟手
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragUp)
    window.addEventListener('pointerup', onDragUp)
  }

  function onDragMove(e: MouseEvent) {
    if (!active || !source) return
    if (ghostEl) {
      ghostEl.style.left = `${e.clientX + 10}px`
      ghostEl.style.top = `${e.clientY + 10}px`
    }
    lastX = e.clientX
    lastY = e.clientY
    needsIndicator = true
    ensureDragLoop()
  }

  function updateDropIndicator(x: number, y: number) {
    const target = findEditorAt(x, y)
    if (target) {
      updateIndicator(target.view, findDropPos(target.view, x, y))
    } else {
      hideIndicator()
    }
  }

  function onDragUp(e: MouseEvent) {
    if (!active || !source) return
    const target = findEditorAt(e.clientX, e.clientY)
    if (target) {
      if (target === source.editor) {
        moveInSameEditor(source, target.view, e.clientX, e.clientY)
      } else {
        moveAcrossEditors(source, target, e.clientX, e.clientY)
      }
    }
    cleanup()
  }

  // 插入位置判定：用鼠标 y 与所在块 DOM rect 中心比较，决定插到块前（before）还是块后（after），与行级指示器一致
  function findDropPos(v: any, x: number, y: number): number {
    const coords = v.posAtCoords({ left: x, top: y })
    if (!coords) return v.state.doc.content.size
    const $pos = v.state.doc.resolve(coords.pos)
    if ($pos.depth === 0) return coords.pos
    const before = $pos.before($pos.depth)
    const after = $pos.after($pos.depth)
    const dom = v.nodeDOM(before) as HTMLElement | null
    if (dom && typeof dom.getBoundingClientRect === 'function') {
      const r = dom.getBoundingClientRect()
      return y < r.top + r.height / 2 ? before : after
    }
    return coords.pos - before < after - coords.pos ? before : after
  }

  // 因删除源块后插入位置会偏移，故经 tr.mapping 修正后再插入
  function moveInSameEditor(s: DragSource, v: any, x: number, y: number) {
    const insertPos0 = findDropPos(v, x, y)
    const tr = v.state.tr
    tr.delete(s.from, s.to)
    const insertPos = tr.mapping.map(insertPos0)
    tr.insert(insertPos, v.state.schema.nodeFromJSON(s.node.toJSON()))
    v.dispatch(tr)
    v.focus()
  }

  function moveAcrossEditors(s: DragSource, target: Editor, x: number, y: number) {
    const tgtView = target.view
    const insertPos = findDropPos(tgtView, x, y)
    const srcView = s.editor.view
    const delTr = srcView.state.tr
    delTr.delete(s.from, s.to)
    srcView.dispatch(delTr)
    // 因各 editor 的 schema 独立不能直接复用节点，故经 nodeFromJSON 转换后插入
    const targetNode = tgtView.state.schema.nodeFromJSON(s.node.toJSON())
    const insTr = tgtView.state.tr
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
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('mousemove', onDragMove)
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

  function updateIndicator(v: any, insertPos: number) {
    if (!indicatorEl) {
      indicatorEl = document.createElement('div')
      indicatorEl.style.cssText =
        'position:fixed;pointer-events:none;height:2px;' +
        'background:rgba(var(--v-theme-primary),0.9);z-index:9998;left:0;top:0;'
      document.body.appendChild(indicatorEl)
    }
    const domRect = v.dom.getBoundingClientRect()
    const coords = v.coordsAtPos(insertPos)
    const y = coords ? coords.bottom : domRect.top
    indicatorEl.style.display = 'block'
    indicatorEl.style.width = `${Math.max(2, Math.round(domRect.width))}px`
    indicatorEl.style.transform = `translate(${Math.round(domRect.left)}px, ${Math.round(y - 1)}px)`
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
