<!-- 最后验证: 2026-10-4 -->
# 09 性能：节流与缓存

## 图 9.1 rAF 节流点汇总

```mermaid
flowchart TB
  subgraph 节流点
    A["panRafId<br/>updatePan → applyPan"]
    B["customDragRafId<br/>onCustomDragMove → applyCustomDrag"]
    C["geometryRafId<br/>scheduleGeometryRefresh → recomputeMasks"]
    D["virtualRafId<br/>scheduleVirtualReconcile → reconcileVirtualBlocks"]
    E["metricsFrame<br/>scheduleScrollMetrics"]
    F["previewRafId<br/>updateAddPreview → applyAddPreview"]
    G["contentResizeFrame<br/>onContentResize → syncAutoHeight"]
    H["tmSyncRaf / bridgeRaf<br/>block-handle 内"]
    I["rtTargetFrame / rtVisibleFrame<br/>帧内缓存"]
  end
```

## 图 9.2 缓存表汇总

```mermaid
flowchart TB
  subgraph WeakMap 缓存
    A["componentPropCache<br/>按 CanvasItem 缓存 props"]
    B["componentRefHandlers<br/>按 CanvasItem 缓存 ref 回调"]
    C["autoHeightHandlers<br/>按 CanvasItem 缓存回调"]
    D["resizeCallbackCache<br/>按 CanvasItem 缓存 resize 回调"]
    E["canvasScaleCache<br/>按 .canvas 元素缓存换算系数"]
  end
  subgraph 显式缓存
    F["edgeMasksMap / cornerHitsMap<br/>shallowRef + recomputeMasks"]
    G["paperclipCandidates<br/>shallowRef"]
    H["virtualSnapshots<br/>shallowRef"]
    I["dragDom / dragHandleEl / dragSettingsEl<br/>会话开始时缓存"]
  end
```

## 图 9.3 命令式 vs 响应式渲染路径

```mermaid
flowchart LR
  subgraph 响应式路径
    A["layout 变化"] --> B["markLayoutDirty()"]
    B --> C["layoutVersion.value++"]
    C --> D["触发依赖它的 computed 重算"]
    D --> E["Vue 渲染 patch"]
  end
  subgraph 命令式路径
    F["layout 变化"] --> G["syncDragDom()"]
    G --> H["applyElStyle 直接写 DOM"]
    H --> I["不触发 patch"]
  end
  J["拖拽期间"] --> F
  K["非拖拽期间"] --> A
```

## 性能三原则

1. **逐帧路径不读 DOM**：用公式换算而不是 getBoundingClientRect
2. **高频路径合并到每帧一次**：rAF 节流
3. **回调与 props 按块缓存**：WeakMap，避免子组件重渲染

## 维护提示

- 新增逐帧路径 → 检查是否走 rAF + 是否读 DOM
- 新增缓存 → 更新图 9.2，并说明失效条件