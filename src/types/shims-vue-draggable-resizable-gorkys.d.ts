// src/shims-vue-draggable-resizable-gorkys.d.ts
declare module 'vue-draggable-resizable-gorkys' {
  import { DefineComponent } from 'vue'

  const VueDraggableResizable: DefineComponent<{
    x?: number
    y?: number
    w?: number
    h?: number
    minw?: number
    minh?: number
    isDraggable?: boolean
    isResizable?: boolean
    parentScaleX?: number
    parentScaleY?: number
    dragHandle?: string
    dragCancel?: string
    // 事件（如果需要）
    onDragstart?: (event: MouseEvent) => void
    onDragmove?: (x: number, y: number, event: MouseEvent) => void
    onDragstop?: (x: number, y: number, event: MouseEvent) => void
    onResizestart?: (event: MouseEvent) => void
    onResizemove?: (x: number, y: number, w: number, h: number, event: MouseEvent) => void
    onResizestop?: (x: number, y: number, w: number, h: number, event: MouseEvent) => void
  }>

  export default VueDraggableResizable
}