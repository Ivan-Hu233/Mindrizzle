// SPDX-License-Identifier: MIT

// 画布叠加层 z-index 体系（从高到低），全项目唯一事实来源。
// CSS（scoped）无法引用 TS 常量，各处 CSS 硬编码的 z-index 必须与本表一致，改动需同步。
//   popup       1005  富文本行操作浮层（block-handle.vue 的 positioner），需在曲别针之上
//   曲别针      1004  块粘贴链接（.snap-paperclip），需在大小手柄之上
//   缩放手柄    1003  块大小调整（ResizeBox .handle），需在描边环之上
//   描边环      1002  选中态主题色描边（.selected-outline），需在拖拽栏之上（高亮边不被手柄遮断）
//   拖拽栏      1001  紧贴块边缘的拖动手柄（.floating-handle），需高于选中块（块重叠时不被盖住）
//   选中块      1000  含块内 popup 对外层级（OJCanvas blockZ），需高于普通块
//   普通块      ≤499  itemZ 受 itemZLimit 限制，恒低于所有叠加层（防普通块盖住 overlay）
export const Z_LAYER = {
  popup: 1005,
  paperclip: 1004,
  resizeHandle: 1003,
  outline: 1002,
  dragHandle: 1001,
  selectedBlock: 1000,
  itemZLimit: 500,
} as const
