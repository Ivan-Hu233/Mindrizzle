<!-- 最后验证: 2026-10-4 -->
# 06 悬浮手柄与 popup

## 图 6.1 hover 状态解析流程

```mermaid
flowchart TD
  A["真实 pointermove"] --> B["useHoverState onPointerResolve（捕获）"]
  B --> C{"event.isTrusted?"}
  C -->|否| Z["忽略"]
  C -->|是| D["rowAtElement(target)"]
  D --> E{"命中块内？"}
  E -->|是| F["cancelHoverClear"]
  F --> G["设置 hoveredBlock / activeHover"]
  G --> H["startKeepAlive()"]
  H --> I["storeOf().hoverState.set(row)"]
  I --> J["overlayOf().setAnchorElement(makeRowAnchor)"]
  E -->|否| K{"target.closest HOVER_UI_SELECTOR?"}
  K -->|是| F
  K -->|否| L["延迟 150ms 清空 activeHover"]
```

## 图 6.2 zoom≠1 时的 pointermove 转发

```mermaid
flowchart TD
  A["真实 pointermove"] --> B["onZoomPointerMove（捕获）"]
  B --> C{"canvasZoom === 1?"}
  C -->|是| Z["忽略"]
  C -->|否| D["event.stopPropagation()"]
  D --> E["forwardPointerMove(clientX, clientY)"]
  E --> F["viewportToLayout 折算为布局坐标"]
  F --> G["派发合成 pointermove"]
  G --> H["派发合成 pointerenter（dom + document）"]
  H --> I["ProseKit hover 扩展解析"]
```

> ProseKit 只认布局坐标、真实指针是视口坐标，所以 zoom≠1 时拦下真实事件、改喂换算后的合成 pointermove。

## 图 6.3 popup 定位选择 handlePlacement

```mermaid
flowchart TD
  A["handlePlacement computed"] --> B{"hoveredBlock?"}
  B -->|否| Z["返回 fallback（ltr=left, rtl=right）"]
  B -->|是| C["getVisibleBlockRectInViewport"]
  C --> D["getClipRect 计算可用空间"]
  D --> E["spaces = {left, right, top, bottom}"]
  E --> F["needs = popupWidth/Height + 4"]
  F --> G["prioritizeVisibleEdges 裁剪边优先"]
  G --> H["choosePlacement 找适配"]
  H --> I{"有 fitting？"}
  I -->|是| J["返回该 placement"]
  I -->|否| K["返回空间/需求比最大者"]
```

## 图 6.4 popup 桥接与滚动条 hover

```mermaid
flowchart TD
  A["popup 显示"] --> B["syncBridgeGap()"]
  B --> C["量 popup 左缘 - 块右缘"]
  C --> D["写 --block-handle-bridge"]
  D --> E["popup::before 跨过空隙"]

  F["popup pointermove"] --> G["onPopupPointerMove"]
  G --> H["syncScrollbarHover(x, y)"]
  H --> I{"barAt 命中滚动条？"}
  I -->|是| J["加 force-hover"]
  I -->|否| K["清 force-hover"]

  L["popup 关闭 / 滚动条拖拽"] --> M["clearScrollbarHover()"]
```

## 图 6.5 activeHandleBlockId 仲裁

```mermaid
flowchart TD
  A["块 A showPopup = true"] --> B["watch(showPopup)"]
  B --> C["activeHandleBlockId.value = A.id"]
  C --> D["块 B watch(activeHandleBlockId)"]
  D --> E{"ownerId !== B.id?"}
  E -->|是| F["B.suppressUI()"]
  E -->|否| G["保持"]
  H["块 A 卸载"] --> I["清空 activeHandleBlockId"]
```

> 多选时 keepAlive 会让已激活 popup 残留、互相"折叠"，用模块级 `activeHandleBlockId` 仲裁。

## 图 6.6 popup 遮挡 tm 手柄检测

```mermaid
flowchart TD
  A["syncTmOverlap()"] --> B["双 rAF"]
  B --> C["查 .block-handle-popup"]
  C --> D["查 .drag-wrapper .handle-tm"]
  D --> E["取两者 BCR"]
  E --> F{"矩形相交？"}
  F -->|是| G["派发 Mindrizzle:block-popup<br/>{open: true, blockId}"]
  F -->|否| H["派发 open: false"]
```

## 维护提示

- 改 popup 放置策略 → 更新图 6.3
- 改桥接区 → 更新图 6.4 + 检查 11-workarounds.md
- 改 owner 仲裁 → 更新图 6.5