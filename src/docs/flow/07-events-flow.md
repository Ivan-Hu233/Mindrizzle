<!-- 最后验证: 2026-10-4 -->
# 07 事件连锁反应

> 事件契约见 02-contracts.md，本文件回答"派发之后发生了什么"。

## 图 7.1 pan / zoom 变化的连锁反应

```mermaid
flowchart TD
  A["pan.x/y 或 zoom.value 变化"] --> B["watch 触发（flush: post）"]
  B --> C["invalidateCanvasScaleCache()"]
  C --> D["派发 Mindrizzle:canvas-transform"]
  D --> E["useHoverState readCanvasZoom"]
  D --> F["useHoverUi onCanvasTransform"]
  D --> G["RichTextEditor onCanvasTransform"]
  D --> H["block-handle 内部监听"]
  B --> I{"customDrag.active?"}
  I -->|是| J["syncDragDom()"]
  I -->|否| K["跳过"]
  B --> L["reconcileVirtualBlocks()"]
  B --> M["canvasStyle / dotsStyle 重算"]
```

## 图 7.2 块选中变化的连锁反应

```mermaid
flowchart TD
  A["state.selectedIds 变化"] --> B["watch 触发"]
  B --> C["派发 Mindrizzle:block-selection"]
  C --> D["useHoverUi onBlockSelectionChange"]
  D --> E["blockSelected 更新"]
  E --> F["handleVisible 重算"]
  F --> G["updateHoverUi"]
  G --> H{"blockSelected 且 activeHover 为空？"}
  H -->|是| I["reassertHoverIfPointerInside"]
  H -->|否| J["跳过"]
  A --> K["selectedOutlineItems 重算"]
  A --> L["blockZ 重算（选中提层）"]
```

## 图 7.3 拖拽开始/结束的全局信号

```mermaid
flowchart TD
  A["startCustomDrag"] --> B["document.body.classList.add('block-handle-dragging')"]
  B --> C["hideAllBlockHandles()"]
  C --> D["向所有 .ProseMirror 派发 -9999 伪事件"]
  D --> E["block-handle body 类隐藏 popup"]
  D --> F["useHoverState onBlockStateChange 清 activeHover"]
  D --> G["useHoverUi updateHoverUi 提前返回"]

  H["onCustomDragUp"] --> I["document.body.classList.remove('block-handle-dragging')"]
  I --> J["popup / highlight 恢复"]
  I --> K["hover 恢复由指针自然触发"]
```

> `document.body.classList.contains('block-handle-dragging')` 是跨编辑器抑制 UI 的**全局 lock**。

## 维护提示

- 新增事件 → 更新 02-contracts + 本文件对应图
- 改事件监听顺序 → 更新图