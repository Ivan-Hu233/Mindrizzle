// 画布叠加层 z-index 体系（全项目唯一事实来源）。
// CSS（scoped）无法引用 TS 常量，各处硬编码的 z-index 必须与本表一致，改动需同步：
// popup 1005 > 曲别针 1004 > 缩放手柄 1003 > 描边环 1002 > 拖拽栏 1001 > 选中块 1000 > itemZLimit 500
export const Z_LAYER = {
  popup: 1005,
  paperclip: 1004,
  resizeHandle: 1003,
  outline: 1002,
  dragHandle: 1001,
  selectedBlock: 1000,
  itemZLimit: 500,
  appLoadingCurtain: 10002,
} as const
