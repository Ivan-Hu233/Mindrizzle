import { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosekit/pm/state'
import type { EditorView } from 'prosekit/pm/view'
import type { Slice } from 'prosekit/pm/model'

export interface RowDropShow {
  view: EditorView
  pos: number
  line: { p1: { x: number; y: number }; p2: { x: number; y: number } }
}

export function createRowDropIndicatorPlugin(options: {
  onShow: (show: RowDropShow) => void
  onHide: () => void
}): Plugin {
  const { onShow, onHide } = options

  function getDropTarget(
    view: EditorView,
    x: number,
    y: number,
  ): { pos: number; y: number } | null {
    const coords = view.posAtCoords({ left: x, top: y })
    if (!coords) return null
    const $pos = view.state.doc.resolve(coords.pos)
    if ($pos.depth === 0) {
      return { pos: coords.pos, y: view.coordsAtPos(coords.pos)?.bottom ?? y }
    }
    const before = $pos.before($pos.depth)
    const after = $pos.after($pos.depth)
    const dom = view.nodeDOM(before) as HTMLElement | null
    if (dom && typeof dom.getBoundingClientRect === 'function') {
      const r = dom.getBoundingClientRect()
      const insertPos = y < r.top + r.height / 2 ? before : after
      const indY = insertPos === before ? r.top : r.bottom
      return { pos: insertPos, y: indY }
    }
    const insertPos = coords.pos - before < after - coords.pos ? before : after
    return { pos: insertPos, y: view.coordsAtPos(insertPos)?.bottom ?? y }
  }

  return new Plugin({
    key: new PluginKey('row-drop-indicator'),
    view(view: EditorView) {
      const dom = view.dom
      let hideId: ReturnType<typeof setTimeout> | undefined
      let hasDragOver = false

      const hide = () => {
        hasDragOver = false
        if (hideId) clearTimeout(hideId)
        hideId = setTimeout(() => {
          if (!hasDragOver) onHide()
        }, 30)
      }

      const handleDragOver = (event: DragEvent) => {
        hasDragOver = true
        const target = getDropTarget(view, event.clientX, event.clientY)
        if (!target) {
          hide()
          return
        }
        const r = view.dom.getBoundingClientRect()
        onShow({
          view,
          pos: target.pos,
          line: { p1: { x: r.left, y: target.y }, p2: { x: r.right, y: target.y } },
        })
      }

      dom.addEventListener('dragover', handleDragOver)
      dom.addEventListener('dragleave', hide)
      dom.addEventListener('drop', hide)
      dom.addEventListener('dragend', hide)

      return {
        destroy() {
          dom.removeEventListener('dragover', handleDragOver)
          dom.removeEventListener('dragleave', hide)
          dom.removeEventListener('drop', hide)
          dom.removeEventListener('dragend', hide)
        },
      }
    },
    props: {
      handleDrop(view: EditorView, event: DragEvent, slice: Slice, move: boolean) {
        const target = getDropTarget(view, event.clientX, event.clientY)
        if (!target) return false
        event.preventDefault()
        const insertPos0 = target.pos
        const tr = view.state.tr
        if (move) {
          const dragging = view.dragging as any
          if (dragging && dragging.node) dragging.node.replace(tr)
          else tr.deleteSelection()
        }
        const pos = tr.mapping.map(insertPos0)
        const isNode = slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
        if (isNode) tr.replaceRangeWith(pos, pos, slice.content.firstChild!)
        else tr.replaceRange(pos, pos, slice)
        const $pos = tr.doc.resolve(pos)
        if (isNode && NodeSelection.isSelectable(slice.content.firstChild!) && $pos.nodeAfter && $pos.nodeAfter.sameMarkup(slice.content.firstChild!)) {
          tr.setSelection(new NodeSelection($pos))
        } else {
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
        }
        view.dispatch(tr.setMeta('uiEvent', 'drop'))
        view.focus()
        return true
      },
    },
  })
}
