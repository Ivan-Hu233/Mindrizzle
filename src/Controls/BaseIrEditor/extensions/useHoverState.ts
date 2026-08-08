// 块 hover 状态：记录被 hover 的块（最后一次保留为拖拽源）与实时 hover，
// 并根据所在编辑器/画布位置计算手柄放置方向。

import { computed, ref } from 'vue'
import type { Editor } from '@prosekit/core'
import { clearStoreHover, getBlockEl, getClipBottom, getClipTop, getPopupHeight, getView, isCompactView } from './blockHandleUtils'

export interface HoveredBlock {
  node: unknown
  pos: number
}

export function useHoverState(
  editor: Editor | null,
  dir: 'ltr' | 'rtl',
  getStore: (el?: Element | null) => any,
) {
  // 最后一次 hover 的块（拖拽源）：hover 离开时不清空，保证拖拽/keepAlive 能拿到被拖块
  const hoveredBlock = ref<HoveredBlock | null>(null)
  // 实时 hover（含移出的 null），驱动行高亮
  const activeHover = ref<HoveredBlock | null>(null)

  function onBlockStateChange(event: Event) {
    const detail = (event as CustomEvent).detail as HoveredBlock | null
    // 拖拽进行中：全局抑制 popup/高亮（body 类由拖拽开始/结束控制，跨编辑器生效）
    if (document.body.classList.contains('block-handle-dragging')) {
      activeHover.value = null
      if (detail) clearStoreHover(getView(editor), getStore)
      return
    }
    activeHover.value = detail
    if (detail) hoveredBlock.value = detail
  }

  // popup 与行之间留出的理想间距；放置判断用 popup 的实际高度 + 该间距
  const COMPACT_POPUP_GAP = 4

  // 手柄放置方向：移动端默认在行上方；按 popup 实际大小与上下可用空间判断放哪侧
  // （上方放得下就放上方，否则放下方，两侧都放不下则选空间大的一侧）。桌面端让 popup
  // 朝向画布内侧（块在左半 → 行右，右半 → 行左）。
  const handlePlacement = computed<'left' | 'right' | 'top' | 'bottom'>(() => {
    const fallback: 'left' | 'right' = dir === 'rtl' ? 'right' : 'left'
    if (!hoveredBlock.value) return fallback

    const view = getView(editor)
    if (isCompactView(view)) {
      const blockEl = getBlockEl(view, hoveredBlock.value.pos)
      if (blockEl) {
        const br = blockEl.getBoundingClientRect()
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
    const canvas = editorDom?.closest('.canvas') as HTMLElement | null
    if (!widget || !canvas) return fallback
    const w = widget.getBoundingClientRect()
    const c = canvas.getBoundingClientRect()
    return w.left + w.width / 2 < c.left + c.width / 2 ? 'right' : 'left'
  })

  return { hoveredBlock, activeHover, handlePlacement, onBlockStateChange }
}
