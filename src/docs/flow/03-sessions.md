<!-- 最后验证: 2026-10-4 -->
# 03 交互会话状态机（MdrCanvas 内部）

> 这个文件里有 5 个会话变量互相抢鼠标，是 bug 高发区。

## 五个会话

| 会话 | 变量 | 启动 | 结束 |
|---|---|---|---|
| 手动平移 | `panSession` | 右键 mousedown | mouseup → stopPan |
| 框选 | `selectionState` | 左键空白 mousedown | mouseup → finishSelection |
| 拖块 | `customDrag` | 左键块/拖拽栏 | mouseup → onCustomDragUp |
| 缩放 | `resizeSession` | 手柄 mousedown | mouseup → onResizeStop |
| 自动平移 | `autoPan` | 任何会话贴边 | 会话结束 → stopAutoPan |

## 图 3.1 五大交互会话总状态机

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Pan: 右键 mousedown<br/>startPan()
  Idle --> Selection: 左键空白 mousedown<br/>startSelection()
  Idle --> CustomDrag: 左键块/拖拽栏<br/>startCustomDrag()
  Idle --> Resize: 手柄 mousedown<br/>onResizeStart()

  Pan --> Idle: mouseup<br/>stopPan()
  Selection --> Idle: mouseup<br/>finishSelection()
  CustomDrag --> Idle: mouseup<br/>onCustomDragUp()
  Resize --> Idle: mouseup<br/>onResizeStop()

  Pan --> AutoPan: 鼠标贴边
  Selection --> AutoPan: 框选拖出
  CustomDrag --> AutoPan: 拖块贴边
  Resize --> AutoPan: 缩块贴边
  AutoPan --> Idle: 会话结束 stopAutoPan()

  Idle --> Idle: abortSessions()<br/>blur / pointercancel
```

## 图 3.2 会话变量与监听器位置

```mermaid
flowchart TB
  subgraph 会话变量
    P["panSession<br/>active, startClientX/Y, startPanX/Y"]
    S["selectionState<br/>active, startX/Y, currentX/Y, extend"]
    D["customDrag<br/>active, sourceItemId, draggingIds, placementLocked"]
    R["resizeSession<br/>itemId, handle, starts, lastBase"]
    A["autoPan<br/>active"]
  end
  subgraph 监听器
    W1["window mousedown capture<br/>onGlobalMouseDownCapture"]
    W2["container mousedown capture<br/>handleCanvasMouseDownCapture"]
    W3["window mousemove capture<br/>updateSelection / updatePan"]
    W4["window mouseup<br/>finishSelection / stopPan"]
    W5["window pointermove capture<br/>onCustomDragMove"]
    W6["window mouseup<br/>onCustomDragUp"]
    W7["window blur / pointercancel<br/>abortSessions"]
  end
  W1 --> P
  W2 --> P
  W3 --> S
  W3 --> P
  W4 --> S
  W4 --> P
  W5 --> D
  W6 --> D
  W7 --> P
  W7 --> S
  W7 --> D
  A -.->|"rAF 循环"| A
```

## 图 3.3 自动平移 autoPanTick 循环

```mermaid
flowchart TD
  A["startAutoPan()"] --> B{"autoPan.active?"}
  B -->|否| Z["结束"]
  B -->|是| C["restrictedPanVelocity()"]
  C --> D["计算 vx / vy"]
  D --> E{"shouldPrioritizeRichText?"}
  E -->|是| F["跳过画布平移"]
  E -->|否| G["pan += 取整速度"]
  G --> H["panCompAcc 补偿被拖块坐标"]
  H --> I["flushDragLayout()"]
  I --> J["compensateResizeAutoPan()"]
  J --> K{"selectionState.active?"}
  K -->|是| L["updateSelectionAt(最近鼠标)"]
  K -->|否| M["跳过"]
  L --> N{"customDrag.active?"}
  M --> N
  F --> N
  N -->|是| O["updateRichTextDrop()"]
  N -->|否| P["跳过"]
  O --> Q["requestAnimationFrame(autoPanTick)"]
  P --> Q
  Q --> B
```

## abortSessions

`window` 的 `blur` / `pointercancel` 会触发 `abortSessions()`，统一重置：

- `customDrag.active` → `onCustomDragUp()`
- `selectionState.active` → `finishSelection()`
- `panSession.active` → `stopPan()`
- `leftButtonDown = false`

**mouseup 丢失会让会话残留、守卫永久禁用**，所以这个函数很关键。

## 维护提示

- 新增会话 → 更新图 3.1、3.2，并加进 abortSessions
- 改监听器位置 → 更新图 3.2
- 改自动平移逻辑 → 更新图 3.3，并检查 04-drag-resize.md