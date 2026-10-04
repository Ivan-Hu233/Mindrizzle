<!-- 最后验证: 2026-10-4 -->
# 00 系统全景

## 心智模型

1. **MdrCanvas.vue 是唯一状态源**：块布局、选中、链接、缩放都在这里。
2. **跨组件通信靠两套契约**：`Mindrizzle:*` CustomEvent + DOM 选择器（详见 02-contracts）。
3. **坐标系是最大认知负担**：画布侧 content/screen/visual 三态，编辑器侧 layout/viewport 两态。

## 图 0.1 系统全景

```mermaid
flowchart TB
  subgraph Canvas["画布层"]
    MC["MdrCanvas.vue"]
    ZI["zIndex.ts"]
    CC["utils/canvasCoords.ts"]
  end

  subgraph Block["块渲染层"]
    RB["ResizeBox.vue"]
    RTE["RichTextEditor.vue"]
    VCN["vue-component.ts"]
    EXT["extension.ts"]
    FMT["formatting.ts"]
    KTX["kateX.ts"]
    RDI["row-drop-indicator.ts + RowDropIndicator.vue"]
  end

  subgraph Handle["悬浮手柄层"]
    BH["block-handle.vue"]
    BHO["blockHandleOwner.ts"]
    UHS["useHoverState.ts"]
    UHU["useHoverUi.ts"]
    UBD["useBlockDrag.ts"]
  end

  subgraph Utils["工具层"]
    BHU["blockHandleUtils.ts"]
  end

  MC --> RB
  RB --> RTE
  RTE --> EXT
  RTE --> VCN
  RTE --> RDI
  EXT --> FMT
  EXT --> KTX
  RTE --> BH
  BH --> UHS
  BH --> UHU
  BH --> UBD
  UHS --> BHU
  UHU --> BHU
  UBD --> BHU
  BH --> BHO
  MC --> CC
  MC --> ZI
  BHU -.->|"读取 DOM 契约"| MC
```

## 图 0.2 import 依赖图

```mermaid
flowchart LR
  MC["MdrCanvas.vue"] --> RB["ResizeBox.vue"]
  MC --> CC["canvasCoords.ts"]
  MC --> ZI["zIndex.ts"]
  MC --> BHU["blockHandleUtils.ts"]
  RB --> VCN["vue-component.ts"]
  VCN --> BHU
  VCN --> BHO["blockHandleOwner.ts"]
  VCN --> RS["resizeConstraints.ts"]
  RTE["RichTextEditor.vue"] --> EXT["extension.ts"]
  RTE --> BH["block-handle.vue"]
  RTE --> RDI["RowDropIndicator.vue"]
  RTE --> BHU
  EXT --> FMT["formatting.ts"]
  EXT --> KTX["kateX.ts"]
  EXT --> VCN
  BH --> UHS["useHoverState.ts"]
  BH --> UHU["useHoverUi.ts"]
  BH --> UBD["useBlockDrag.ts"]
  BH --> BHU
  UHS --> BHU
  UHU --> BHU
  UBD --> BHU
  RDI --> RDIP["row-drop-indicator.ts"]
```

## 层职责

- **画布层**：MdrCanvas 管布局/会话/缩放；zIndex 定层；canvasCoords 管换算。
- **块渲染层**：ResizeBox 提供拖拽/缩放手柄；RichTextEditor 承载 ProseMirror；vue-component 是 PM 节点视图。
- **悬浮手柄层**：block-handle + 三个 hook，负责 hover / popup / 行拖拽。
- **工具层**：blockHandleUtils 是编辑器侧唯一坐标与几何入口。

## 维护提示

- 新增文件 → 更新图 0.1、0.2
- 新增跨层依赖 → 检查是否应该走事件而不是 import