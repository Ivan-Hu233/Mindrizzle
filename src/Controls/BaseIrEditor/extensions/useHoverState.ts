import { computed, ref } from 'vue'
import type { Editor } from '@prosekit/core'
import { clearStoreHover, dispatchBlockHover, getBlockRect, getClipBottom, getClipTop, getPopupHeight, getPopupWidth, getView, isCompactView, getRealPointer } from './blockHandleUtils'

export interface HoveredBlock {
  node: unknown
  pos: number
}

export function useHoverState(
  editor: Editor | null,
  dir: 'ltr' | 'rtl',
  getStore: (el?: Element | null) => any,
) {
  // 拖拽/keepAlive 需拿最后一次 hover 的块作拖拽源，hover 离开时不清空 hoveredBlock
  const hoveredBlock = ref<HoveredBlock | null>(null)
  const activeHover = ref<HoveredBlock | null>(null)

  // 因鼠标停住时若光标下 DOM 被替换（画布提升层级/工具栏插入等），浏览器会派发坐标无意义的
  // pointerout（clientX/clientY 为 0），扩展按该坐标判为无块命中并在 180ms 后清 hover，
  // 表现为 popup 自己消失、必须再动鼠标才回来；故收到空 hover 时按真实指针位置复核
  function isPointerInsideBlock(block: HoveredBlock): boolean {
    const { x, y } = getRealPointer()
    if (Number.isNaN(x)) return false
    const rect = getBlockRect(getView(editor), block.pos)
    if (!rect) return false
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  function onBlockStateChange(event: Event) {
    const detail = (event as CustomEvent).detail as HoveredBlock | null
    // 拖拽需跨编辑器全局抑制 popup/高亮，通过 body 上的拖拽类判断
    if (document.body.classList.contains('block-handle-dragging')) {
      activeHover.value = null
      if (detail) clearStoreHover(getView(editor), getStore)
      return
    }
    // 指针仍在块内说明扩展这轮空 hover 是坐标误报，保留当前 hover 并请扩展重新确认
    const hovered = hoveredBlock.value
    if (!detail && hovered && isPointerInsideBlock(hovered)) {
      dispatchBlockHover(getView(editor), hovered.pos)
      return
    }
    activeHover.value = detail
    if (detail) hoveredBlock.value = detail
  }

  // popup 需与行保持 4px 间距，放置判断以 popup 实际高度 + 该间距为所需空间
  const COMPACT_POPUP_GAP = 4

  // 放置规则：移动端优先上方、桌面端优先朝向画布内侧（块在左半 → 行右），空间不足时退化为另一侧/上下
  const handlePlacement = computed<'left' | 'right' | 'top' | 'bottom'>(() => {
    const fallback: 'left' | 'right' = dir === 'rtl' ? 'right' : 'left'
    if (!hoveredBlock.value) return fallback

    const view = getView(editor)
    if (isCompactView(view)) {
      const br = getBlockRect(view, hoveredBlock.value.pos)
      if (br) {
        const need = getPopupHeight(view) + COMPACT_POPUP_GAP
        const spaceAbove = br.top - getClipTop(view)
        const spaceBelow = getClipBottom(view) - br.bottom
        if (spaceAbove >= need) return 'top'
        if (spaceBelow >= need) return 'bottom'
        return spaceAbove >= spaceBelow ? 'top' : 'bottom'
      }
      return 'top'
    }

    const editorDom = view?.dom as HTMLElement | null
    const widget = editorDom?.closest('.drag-wrapper') as HTMLElement | null
    // 无限画布下世界层远大于视口、按它判断内外会恒为同一侧，改用可见视口 .canvas-container 判断
    const container = editorDom?.closest('.canvas-container') as HTMLElement | null
    if (!widget || !container) return fallback
    const w = widget.getBoundingClientRect()
    const c = container.getBoundingClientRect()
    const preferred: 'left' | 'right' = w.left + w.width / 2 < c.left + c.width / 2 ? 'right' : 'left'

    // 桌面端左右放不下 popup 时需退化为上下放置；左右空间用整块边界（不用文本行 nodeDOM，
    // nodeDOM(pos) 部分情况取不到元素）；且桌面端 top/bottom 不放大，退化时大小与左右放置一致
    const needX = getPopupWidth(view) + COMPACT_POPUP_GAP
    const spaceLeft = w.left - c.left
    const spaceRight = c.right - w.right
    if (spaceLeft < needX && spaceRight < needX) {
      const br = getBlockRect(view, hoveredBlock.value.pos)
      const top = br ? br.top : w.top
      const bottom = br ? br.bottom : w.bottom
      const needY = getPopupHeight(view) + COMPACT_POPUP_GAP
      const spaceAbove = top - getClipTop(view)
      const spaceBelow = getClipBottom(view) - bottom
      if (spaceAbove >= needY) return 'top'
      if (spaceBelow >= needY) return 'bottom'
      return spaceAbove >= spaceBelow ? 'top' : 'bottom'
    }
    return preferred
  })

  return { hoveredBlock, activeHover, handlePlacement, onBlockStateChange }
}
