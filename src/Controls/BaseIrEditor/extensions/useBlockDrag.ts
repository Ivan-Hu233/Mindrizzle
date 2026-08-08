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

  // 拖拽中隐藏行高亮（避免与 NodeSelection 选区框重叠）
  const isDragging = ref(false)
  let active = false
  let source: DragSource | null = null
  let ghostEl: HTMLElement | null = null
  let indicatorEl: HTMLElement | null = null
  // 拖拽中「落点/指示器」计算较重（elementFromPoint + posAtCoords + getBoundingClientRect），
  // 用 rAF 合并到每帧最多一次，避免每次 mousemove 都触发 layout 重排造成拖拽卡顿。
  let rafId = 0
  let pendingX = 0
  let pendingY = 0

  // 通过鼠标坐标找到所在的编辑器实例（支持跨编辑器拖拽）
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

  function onDragPointerDown(e: PointerEvent) {
    const v = view()
    const block = hoveredBlock.value
    const node = block?.node as any
    if (!v || !block || !node) return
    e.preventDefault() // 阻止原生 HTML5 拖拽
    e.stopPropagation()
    // 选中节点（保持点击手柄选中块的行为）
    try {
      const sel = NodeSelection.create(v.state.doc, block.pos)
      v.dispatch(v.state.tr.setSelection(sel))
    } catch {
      /* noop */
    }

    source = { editor: editor as Editor, node, from: block.pos, to: block.pos + node.nodeSize }
    active = true
    isDragging.value = true
    document.body.classList.add('block-handle-dragging') // 全局抑制所有 popup/高亮
    suppressUI() // 关闭当前 popup / 高亮 / keepAlive
    createGhost(node, e.clientX, e.clientY)
    // window 级监听：mouse.down 后部分环境不再派发 mousemove，但 pointermove 稳定
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragUp)
    window.addEventListener('pointerup', onDragUp)
  }

  function onDragMove(e: MouseEvent) {
    if (!active || !source) return
    // ghost 跟随鼠标：纯样式写，实时更新（保持拖拽跟手）
    if (ghostEl) {
      ghostEl.style.left = `${e.clientX + 10}px`
      ghostEl.style.top = `${e.clientY + 10}px`
    }
    // 落点 / 指示器计算较重：合并到 rAF，每帧最多一次
    pendingX = e.clientX
    pendingY = e.clientY
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0
        if (!active || !source) return
        updateDropIndicator(pendingX, pendingY)
      })
    }
  }

  // 在目标编辑器上显示/隐藏插入指示器（自绘 position:fixed 线，viewport 坐标）
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

  /**
   * 计算目标编辑器的插入位置：用鼠标 y 与鼠标所在块的 DOM rect 中心比较，
   * 决定插到块前（before）还是块后（after），与行级指示器显示位置完全一致。
   */
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

  /** 同编辑器内移动：删除源块后按 tr.mapping 修正位置再插入。 */
  function moveInSameEditor(s: DragSource, v: any, x: number, y: number) {
    const insertPos0 = findDropPos(v, x, y)
    const tr = v.state.tr
    tr.delete(s.from, s.to)
    const insertPos = tr.mapping.map(insertPos0)
    tr.insert(insertPos, v.state.schema.nodeFromJSON(s.node.toJSON()))
    v.dispatch(tr)
    v.focus()
  }

  /** 跨编辑器移动：源编辑器删除，目标编辑器转换 schema 后插入。 */
  function moveAcrossEditors(s: DragSource, target: Editor, x: number, y: number) {
    const tgtView = target.view
    const insertPos = findDropPos(tgtView, x, y)
    // 1) 源编辑器删除被拖块
    const srcView = s.editor.view
    const delTr = srcView.state.tr
    delTr.delete(s.from, s.to)
    srcView.dispatch(delTr)
    // 2) 目标编辑器插入（每个 editor 的 schema 独立，需 nodeFromJSON 转换）
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

  // ---- 拖拽 ghost（蓝框 + 文字）与插入指示器 ----
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
