<!-- 最后验证: 2026-10-4 -->
# 01 坐标系

## 三句话

1. **screen 与 viewport 是同一个东西**（clientX/Y），只是两个文件起了不同名字。
2. **content 与 layout 不是同一个东西**，但都绑定同一块 DOM；它们之间没有直接公式，只有"把块当锚点"对齐。
3. **getCanvasScale 里的 domScale 是实测修正**，不是推导，接受它是经验值。

## 图 1.1 双坐标系总图

```mermaid
flowchart LR
  subgraph CS["画布侧 canvasCoords.ts"]
    C["content 坐标<br/>layout.x / layout.y"]
    S["screen 坐标<br/>clientX / clientY"]
    V["visual 坐标<br/>取整像素"]
    C -->|"contentToScreen<br/>× zoom + origin + pan + 容器偏移"| S
    S -->|"screenToContent 逆变换"| C
    C -->|"roundToVisual / roundToPx"| V
  end

  subgraph ES["编辑器侧 blockHandleUtils.ts"]
    L["layout 坐标<br/>BCR 布局空间"]
    VP["viewport 坐标<br/>clientX / clientY"]
    K["k = zoom / domScale<br/>domScale = canvas宽/容器宽 × zoom"]
    L -->|"× k"| VP
    VP -->|"÷ k"| L
    K -.-> L
  end

  S <-.->|"同一物"| VP
  C -.->|"经 .drag-wrapper[data-id]<br/>与块 DOM 对齐"| L
```

## 图 1.2 getCanvasScale 系数推导

```mermaid
flowchart TD
  A["getCanvasScale(view)"] --> B{".canvas 元素存在？"}
  B -->|否| Z["返回 1"]
  B -->|是| C{"缓存命中<br/>且 epoch 一致？"}
  C -->|是| D["返回缓存值"]
  C -->|否| E["读 canvas 的 computed zoom"]
  E --> F["实测 canvas.width / container.width"]
  F --> G["domScale = 比值 × zoom"]
  G --> H["k = zoom / domScale"]
  H --> I["写入缓存（带 epoch）"]
  I --> D
```

**说明**：`domScale` 是为兼容"BCR 是否含 zoom"的浏览器差异而实测的，不是公式推导。

## 图 1.3 坐标系换算函数索引

```mermaid
flowchart LR
  subgraph 画布侧["canvasCoords.ts"]
    A1["contentToScreen(t, viewport, x, y)"]
    A2["screenToContent(t, viewport, x, y)"]
    A3["contentToVisual(t, x, y)"]
    A4["roundToVisual(zoom, v)"]
  end
  subgraph 编辑器侧["blockHandleUtils.ts"]
    B1["layoutToViewportX/Y/Size"]
    B2["viewportToLayout"]
  end
  subgraph MdrCanvas["MdrCanvas.vue"]
    C1["roundToPx = roundToVisual(zoom, v)"]
    C2["visualY(v) = contentToVisual(t, 0, v).y"]
  end
  A1 --> C2
  A4 --> C1
  B1 --> B2
```

## 验收标准

你能指着图说出以下函数在哪条边上：

- `contentToScreen` / `screenToContent`
- `roundToPx` / `roundToVisual` / `visualY`
- `layoutToViewportX/Y/Size` / `viewportToLayout`

说不出，说明还没读懂。

## 维护提示

- 新增坐标系 → 更新图 1.1
- 新增换算函数 → 更新图 1.3
- 改 getCanvasScale → 检查 11-workarounds.md