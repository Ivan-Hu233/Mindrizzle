// 块 hover 状态：记录被 hover 的块（最后一次保留为拖拽源）与实时 hover，
// 并根据所在编辑器/画布位置计算手柄放置方向。

import { computed, ref } from 'vue'
import type { Editor } from '@prosekit/core'
import { clearStoreHover, getView, isCompactView } from './blockHandleUtils'

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

  // 手柄放置方向：移动端在行上方；桌面端让 popup 朝向画布内侧（块在左半 → 行右，右半 → 行左）
  const handlePlacement = computed<'left' | 'right' | 'top'>(() => {
    const fallback: 'left' | 'right' = dir === 'rtl' ? 'right' : 'left'
    if (!hoveredBlock.value) return fallback

    const view = getView(editor)
    if (isCompactView(view)) return 'top'

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
