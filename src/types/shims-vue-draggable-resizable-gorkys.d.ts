declare module 'vue-draggable-resizable-gorkys' { // 因该库未自带类型声明，故手动定义
  import { DefineComponent } from 'vue'

  export type Handle = 'tl' | 'tm' | 'tr' | 'mr' | 'br' | 'bm' | 'bl' | 'ml'

  export interface HandleInfo {
    size?: number
    offset?: number
    switch?: boolean
  }

  export interface RefLine {
    display: boolean
    position: string   // 例如 "100px"
    origin: string     // 例如 "50px"
    lineLength: string // 例如 "200px"
  }

  export interface RefLineParams {
    vLine: RefLine[]
    hLine: RefLine[]
  }

  const VueDraggableResizable: DefineComponent<
    {
      className?: string
      classNameDraggable?: string
      classNameResizable?: string
      classNameDragging?: string
      classNameResizing?: string
      classNameActive?: string
      classNameHandle?: string

      disableUserSelect?: boolean
      enableNativeDrag?: boolean
      preventDeactivation?: boolean

      active?: boolean // v-model:active

      draggable?: boolean
      resizable?: boolean

      w?: number | 'auto'
      h?: number | 'auto'
      minWidth?: number
      minHeight?: number
      maxWidth?: number | null
      maxHeight?: number | null
      x?: number
      y?: number
      z?: number | 'auto' // z-index，'auto' 表示自动

      rotate?: number

      handles?: Handle[]

      dragHandle?: string | null // 选择器，限定拖拽把手
      dragCancel?: string | null // 选择器，点击这些元素不触发拖拽

      axis?: 'x' | 'y' | 'both'

      grid?: [number, number]

      parent?: boolean | string // true=父节点，string=CSS选择器

      onDragStart?: (event: MouseEvent | TouchEvent) => boolean | void
      onDrag?: (left: number, top: number) => boolean | void
      onResizeStart?: (handle: Handle, event: MouseEvent | TouchEvent) => boolean | void
      onResize?: (handle: Handle, left: number, top: number, width: number, height: number) => boolean | void

      isConflictCheck?: boolean
      snap?: boolean
      snapTolerance?: number

      scaleRatio?: number

      handleInfo?: HandleInfo

      activeOnTop?: boolean
      selectOnContextMenu?: boolean
    },
    {},
    unknown,
    {},
    {},
    {},
    {},
    {
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