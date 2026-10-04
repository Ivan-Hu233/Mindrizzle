<!-- 最后验证: 2026-10-4 -->
# 04 拖拽与缩放

## 图 4.1 拖拽主流程

```mermaid
flowchart TD
  A["startCustomDrag(item, e)"] --> B["selectForDrag 选中"]
  B --> C["收集 customDragGroup"]
  C --> D["collectLinkedIds 联结块"]
  D --> E["cacheDragDom 缓存 DOM 引用"]
  E --> F["挂 window pointermove/mousemove 捕获"]
  F --> G["startAutoPan()"]
  G --> H["onCustomDragMove（rAF 节流）"]
  H --> I["applyCustomDrag"]
  I --> J["按 dx/dy/pan 改 layout"]
  J --> K["snapLayoutToOthers 吸附"]
  K --> L["findRichTextDropTarget"]
  L --> M["updateRichTextDrop 落点线"]
  M --> N["flushDragLayout 命令式写 DOM"]
  N --> H
  H --> O["onCustomDragUp"]
  O --> P{"落在富文本块上？"}
  P -->|是| Q["insertDraggedComponent"]
  P -->|否| R["resolveDragConflict 冲突回退"]
  Q --> S["清理会话 + recomputeMasks"]
  R --> S
  S --> T["markLayoutDirty()"]
```

## 图 4.2 命令式 DOM 同步路径

```mermaid
flowchart LR
  A["customDragItems<br/>Map(id → CanvasItem)"] --> B["cacheDragDom()"]
  B --> C["dragDom: Map(id → {wrapper, outline})"]
  B --> D["dragHandleEl"]
  B --> E["dragSettingsEl"]
  C --> F["syncDragDom()"]
  D --> F
  E --> F
  F --> G["applyElStyle 直接写 style"]
  G --> H{"dragNeedsRender?"}
  H -->|是| I["markLayoutDirty()"]
  H -->|否| J["仅命令式同步"]
```

> 拖拽期间 layout 不触发渲染，块本体与跟随浮层靠命令式写 DOM。只有存在链接时 `dragNeedsRender = true` 退回逐帧重渲染。

## 图 4.3 Resize 与联结传播

```mermaid
flowchart TD
  A["onResizeStart(item, handle)"] --> B["captureLinkedStarts<br/>收集联结块起始 Rect"]
  B --> C["resizeSession = {itemId, handle, starts, lastBase, panStart}"]
  C --> D["onResizing(item, x, y, w, h)"]
  D --> E["rs.lastBase = {x, y, w, h}"]
  E --> F["restrictedPanVelocity()"]
  F --> G["applyResizeLayout(item, propagate)"]
  G --> H["applyPanCorrection<br/>按 dpX/dpY 补偿"]
  H --> I["snapResizeEdges<br/>吸附边/中线"]
  I --> J["写 layout + markLayoutDirty"]
  J --> K{"propagate?"}
  K -->|是| L["syncLinkedEdges"]
  K -->|否| M["冻结传播"]
  L --> N["propagateLinkedEdges BFS"]
  N --> O["分维传播（seenX / seenY）"]
  O --> P["写回 layout"]
  P --> Q["onResizeStop"]
  Q --> R["stopAutoPan()"]
  R --> S["applyResizeLayout(item, true)"]
  S --> T["resizeSession = null<br/>recomputeMasks()"]
```

## 图 4.4 propagateLinkedEdges 分维 BFS

```mermaid
flowchart TD
  A["propagateLinkedEdges(item, rect, starts)"] --> B["positions 用当前 layout 初始化"]
  B --> C["queue = [item.id]"]
  C --> D{"queue 非空？"}
  D -->|是| E["取 pid, pRect, pStart"]
  E --> F["遍历 neighborMap.get(pid)"]
  F --> G{"xTouching / yTouching?"}
  G --> H{"N 在 P 右且未处理 x？"}
  H -->|是| I["nNew.x = pRect.x + pRect.w<br/>nNew.w 重算"]
  H -->|否| J{"N 在 P 左且未处理 x？"}
  J -->|是| K["nNew.w 重算<br/>nNew.x 贴合 P 左缘"]
  J -->|否| L{"N 在 P 下且未处理 y？"}
  L -->|是| M["nNew.y = pRect.y + pRect.h<br/>nNew.h 重算"]
  L -->|否| N{"N 在 P 上且未处理 y？"}
  N -->|是| O["nNew.h 重算<br/>nNew.y 贴合 P 上缘"]
  N -->|否| P["跳过"]
  I --> Q["seenX/seenY 标记 + enqueue"]
  K --> Q
  M --> Q
  O --> Q
  P --> D
  Q --> D
  D -->|否| R["写回 positions 到 layout"]
  R --> S["返回 changedIds"]
```

> 分维 BFS 的关键：`seenX` / `seenY` 独立标记，避免交叉轴被反复拉走。

## 图 4.5 useBlockDrag 行拖拽

```mermaid
flowchart TD
  A["onDragPointerDown"] --> B["NodeSelection.create + dispatch"]
  B --> C["source = {editor, node, from, to}"]
  C --> D["createGhost 跟随鼠标"]
  D --> E["挂 pointermove/mouseup（捕获）"]
  E --> F["dragLoop（rAF）"]
  F --> G["resolveEditorHit(x, y)"]
  G --> H["autoScroll 块内滚动"]
  H --> I["panCanvas 画布平移"]
  I --> J{"needsIndicator / scrolled / panned?"}
  J -->|是| K["resolveDropAnchor + updateIndicator"]
  J -->|否| L["跳过"]
  K --> M["ensureDragLoop()"]
  L --> M
  F --> N["onDragUp"]
  N --> O{"同一编辑器？"}
  O -->|是| P["moveInSameEditor"]
  O -->|否| Q["moveAcrossEditors"]
  P --> R["cleanup()"]
  Q --> R
```

> 这是编辑器内的行级拖拽，与画布级块拖拽（4.1）完全不同。**Tauri Linux 的 WebKitGTK 不派发 HTML5 DnD**，所以用 pointerdown + window 级事件自实现。

## 维护提示

- 改拖拽吸附逻辑 → 更新图 4.1，并补充相关回归验证
- 改 propagateLinkedEdges → 更新图 4.4 + 加特征测试
- 改命令式同步 → 更新图 4.2