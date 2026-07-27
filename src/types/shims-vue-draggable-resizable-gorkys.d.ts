// shims-vue-draggable-resizable-gorkys.d.ts
declare module 'vue-draggable-resizable-gorkys' {
  import { DefineComponent } from 'vue'

  // 控制柄类型（8 个方向）
  export type Handle = 'tl' | 'tm' | 'tr' | 'mr' | 'br' | 'bm' | 'bl' | 'ml'

  // handleInfo 配置
  export interface HandleInfo {
    size?: number   // 控制柄尺寸
    offset?: number // 偏移量
    switch?: boolean // 是否显示控制柄
  }

  // 辅助线参数（refLineParams 事件）
  export interface RefLine {
    display: boolean
    position: string   // 例如 "100px"
    origin: string     // 例如 "50px"
    lineLength: string // 例如 "200px"
  }

  export interface RefLineParams {
    vLine: RefLine[]   // 垂直线（通常长度为 3）
    hLine: RefLine[]   // 水平线（通常长度为 3）
  }

  const VueDraggableResizable: DefineComponent<
    {
      // ----- 样式/类名 -----
      className?: string
      classNameDraggable?: string
      classNameResizable?: string
      classNameDragging?: string
      classNameResizing?: string
      classNameActive?: string
      classNameHandle?: string

      // ----- 行为控制 -----
      disableUserSelect?: boolean
      enableNativeDrag?: boolean
      preventDeactivation?: boolean

      // ----- 激活状态 -----
      active?: boolean // v-model:active

      // ----- 拖拽/缩放开关 -----
      draggable?: boolean
      resizable?: boolean

      // ----- 尺寸与位置 -----
      w?: number | 'auto'
      h?: number | 'auto'
      minWidth?: number
      minHeight?: number
      maxWidth?: number | null
      maxHeight?: number | null
      x?: number
      y?: number
      z?: number | 'auto' // z-index，'auto' 表示自动

      // ----- 旋转 -----
      rotate?: number // 角度

      // ----- 控制柄列表 -----
      handles?: Handle[]

      // ----- 拖拽区域限定 -----
      dragHandle?: string | null // 选择器，限定拖拽把手
      dragCancel?: string | null // 选择器，点击这些元素不触发拖拽

      // ----- 移动轴 -----
      axis?: 'x' | 'y' | 'both'

      // ----- 网格吸附 -----
      grid?: [number, number] // [gridX, gridY]

      // ----- 父容器限制 -----
      parent?: boolean | string // true=父节点，string=CSS选择器

      // ----- 生命周期钩子（可返回 false 阻止操作）-----
      onDragStart?: (event: MouseEvent | TouchEvent) => boolean | void
      onDrag?: (left: number, top: number) => boolean | void
      onResizeStart?: (handle: Handle, event: MouseEvent | TouchEvent) => boolean | void
      onResize?: (handle: Handle, left: number, top: number, width: number, height: number) => boolean | void

      // ----- 冲突检测与对齐 -----
      isConflictCheck?: boolean
      snap?: boolean
      snapTolerance?: number

      // ----- 缩放比例 -----
      scaleRatio?: number

      // ----- 控制柄外观 -----
      handleInfo?: HandleInfo

      // ----- 层级与右键 -----
      activeOnTop?: boolean // 激活时提升到最前
      selectOnContextMenu?: boolean // 右键点击时激活组件
    },
    {}, // 普通 slots
    unknown,
    {},
    {},
    {},
    {},
    {
      // ----- 事件（emits）-----
      'update:active': (value: boolean) => void
      activated: () => void
      deactivated: () => void
      contextmenu: (event: MouseEvent) => void

      dragging: (left: number, top: number) => void
      dragstop: (left: number, top: number) => void

      resizing: (left: number, top: number, width: number, height: number) => void
      resizestop: (left: number, top: number, width: number, height: number) => void

      refLineParams: (params: RefLineParams) => void
    }
  >

  export default VueDraggableResizable
}