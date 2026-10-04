<!-- 最后验证: 2026-10-4 -->
# 11 Workarounds

> 这些地方代码看不懂很正常——**它们不是逻辑，是 workaround**。给它们贴标签，比读懂它们更值。

## 图 11.1 Workaround 索引

```mermaid
flowchart TB
  A["ProseKit hover 200ms 节流"] --> A1["keepAlive setInterval 150ms"]
  B["ProseKit hover 失效缓冲"] --> B1["clearHoverViaExtension 派发 -9999 伪事件"]
  C["BCR 是否含 zoom 因浏览器而异"] --> C1["getCanvasScale 实测 domScale"]
  D["多编辑器 hover 互相干扰"] --> D1["activeHandleBlockId 全局仲裁"]
  E["跨编辑器全局抑制 UI"] --> E1["document.body.classList<br/>block-handle-dragging"]
  F["popup 与块间空隙丢 hover"] --> F1["popup::before 桥接区<br/>syncBridgeGap 实测宽度"]
  G["滚动条被 popup 桥接区吞掉"] --> G1["syncScrollbarHover 手动加 force-hover"]
  H["floating-ui 在 0 尺寸间跳变"] --> H1["ui-hidden 用 visibility/opacity"]
  I["拖拽期逐帧 patch 卡顿"] --> I1["markRaw + 命令式写 DOM"]
  J["Tauri Linux WebKitGTK 无 DnD"] --> J1["useBlockDrag 自实现指针拖拽"]
```

## 图 11.2 -9999 伪事件机制

```mermaid
sequenceDiagram
  participant MC as MdrCanvas
  participant PM as ProseMirror DOM
  participant Ext as hover 扩展
  participant BH as block-handle

  MC->>PM: dispatch PointerEvent pointermove<br/>clientX/Y = -9999
  PM->>Ext: 冒泡到扩展
  Ext->>Ext: 坐标在块外，清 hover
  MC->>PM: dispatch PointerEvent pointerout
  PM->>Ext: 冒泡
  Ext->>Ext: 缓存失效
  Ext-->>BH: state-change
  BH->>BH: 收起 popup
```

## 判断原则

看到下面这些特征，先想"它在防御什么"，而不是"它为什么这么写"：

- `setInterval(..., 150)`：对抗 ProseKit 的 200ms 节流
- `clientX: -9999`：强制清 hover
- `document.body.classList`：跨组件全局 lock
- 实测比值代替公式：兼容浏览器差异
- `!important` 大量出现：覆盖第三方库内联样式

## 维护提示

- 第三方库升级 → 重新验证这些 workaround 是否还需要
- 新增 workaround → 更新图 11.1，并写清"防御什么"