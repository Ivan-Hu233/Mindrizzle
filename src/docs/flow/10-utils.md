<!-- 最后验证: 2026-10-4 -->
# 10 工具函数索引

## 图 10.1 blockHandleUtils 函数分类

```mermaid
flowchart TB
  subgraph 编辑器访问
    A1["getView(editor)"]
    A2["getScrollEl(view)"]
    A3["getBlockEl(view, pos)"]
    A4["findPositionerEl(view)"]
  end
  subgraph 几何测量
    B1["getVisibleBlockRect(el)"]
    B2["getBlockRect(view, pos)"]
    B3["getClipRect(view)"]
    B4["getVisibleBlockRectInViewport(view, el)"]
    B5["isFullyVisibleInCanvas(el)"]
    B6["getPopupHeight / getPopupWidth"]
  end
  subgraph 坐标换算
    C1["layoutToViewportX/Y/Size"]
    C2["viewportToLayout"]
    C3["getCanvasScale（内部）"]
    C4["invalidateCanvasScaleCache"]
  end
  subgraph 指针与 hover
    D1["getRealPointer()"]
    D2["isPointerInsideRect(rect)"]
    D3["dispatchBlockHover(view, pos)"]
  end
  subgraph Context 解析
    E1["createStoreResolver"]
    E2["createOverlayStoreResolver"]
    E3["clearStoreHover"]
    E4["isCompactView(view)"]
  end
```

## 图 10.2 canvasCoords 函数

```mermaid
flowchart LR
  A["CanvasTransform<br/>{zoom, origin, pan}"] --> B["contentToScreen(t, viewport, x, y)"]
  A --> C["screenToContent(t, viewport, x, y)"]
  A --> D["contentToVisual(t, x, y)"]
  E["roundToVisual(zoom, v)"] --> D
```

## 使用原则

- **编辑器内代码**：只用 `blockHandleUtils`，不要直接读 BCR 做换算
- **画布内代码**：只用 `canvasCoords`，不要自己拼公式
- **跨边界**：clientX/Y 是唯一共同的坐标空间

## 维护提示

- 新增换算函数 → 更新图 10.1 或 10.2
- 函数归类变化 → 更新对应图