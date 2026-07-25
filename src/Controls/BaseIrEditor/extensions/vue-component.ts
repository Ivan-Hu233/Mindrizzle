import { defineNodeSpec } from '@prosekit/core'
import { defineVueNodeView } from '@prosekit/vue'
import { h, defineComponent, ref, watch, onUnmounted, reactive, PropType } from 'vue'
import { mdiArrowBottomRight } from "@mdi/js"
import { VIcon } from 'vuetify/components'

// ==================== 类型定义 ====================

type ResizeConstraints = {
  minWidth?: number | null
  maxWidth?: number | null
  minHeight?: number | null
  maxHeight?: number | null
}

interface ComponentEntry {
  loader: () => Promise<{
    default: any
    resizeConstraints?: ResizeConstraints
  }>
  aspectRatio?: number | null
}

// ==================== 组件注册表 ====================

const componentMap: Record<string, ComponentEntry> = {
  CodeBlock: {
    loader: () => import('../../EditorPlugin/EditableCodeBlock.vue'),
  },
  // 在此追加其他组件
}

// 默认约束（当组件未显式设置时使用）
const DEFAULT_CONSTRAINTS: Required<ResizeConstraints> = {
  minWidth: 100,
  maxWidth: 800,
  minHeight: 80,
  maxHeight: 600,
}

// ==================== 加载与缓存 ====================

const loadedCache = new Map<string, { component: any; constraints: Required<ResizeConstraints> }>()

async function loadComponent(name: string) {
  if (loadedCache.has(name)) return loadedCache.get(name)!
  const entry = componentMap[name]
  if (!entry) throw new Error(`未知组件：${name}`)
  const module = await entry.loader()
  const comp = module.default
  const raw = module.resizeConstraints || {}
  // 处理 null 表示无限制，undefined 回退默认
  const constraints: Required<ResizeConstraints> = {
    minWidth: raw.minWidth === undefined ? DEFAULT_CONSTRAINTS.minWidth : raw.minWidth,
    maxWidth: raw.maxWidth === undefined ? DEFAULT_CONSTRAINTS.maxWidth : raw.maxWidth,
    minHeight: raw.minHeight === undefined ? DEFAULT_CONSTRAINTS.minHeight : raw.minHeight,
    maxHeight: raw.maxHeight === undefined ? DEFAULT_CONSTRAINTS.maxHeight : raw.maxHeight,
  }
  const result = { component: comp, constraints }
  loadedCache.set(name, result)
  return result
}

// ==================== 节点规范 ====================

export const vueComponentNode = defineNodeSpec({
  name: 'vueComponent',
  group: 'block',
  atom: true,
  isolating: true,
  attrs: {
    componentName: { default: 'MyCard' },
    props: { default: {} },
    width: { default: 360 },
    height: { default: 240 },
  },
  parseDOM: [
    {
      tag: 'div[data-vue-component]',
      getAttrs(dom) {
        const el = dom as HTMLElement
        return {
          componentName: el.getAttribute('data-component-name') || 'MyCard',
          props: JSON.parse(el.getAttribute('data-props') || '{}'),
          width: parseFloat(el.getAttribute('data-width') || '360'),
          height: parseFloat(el.getAttribute('data-height') || '240'),
        }
      },
    },
  ],
  toDOM(node) {
    return [
      'div',
      {
        'data-vue-component': '',
        'data-component-name': node.attrs.componentName,
        'data-props': JSON.stringify(node.attrs.props),
        'data-width': String(node.attrs.width),
        'data-height': String(node.attrs.height),
      },
    ]
  },
})

// ==================== 可调整容器 ====================

const ResizableContainer = defineComponent({
  name: 'ResizableContainer',
  props: {
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    aspectRatio: { type: Number, default: null },
    minWidth: { type: Number as PropType<number | null>, default: null },
    maxWidth: { type: Number as PropType<number | null>, default: null },
    minHeight: { type: Number as PropType<number | null>, default: null },
    maxHeight: { type: Number as PropType<number | null>, default: null },
  },
  emits: ['resize'],
  setup(props, { emit, slots }) {
    const containerRef = ref<HTMLElement | null>(null)
    const isResizing = ref(false)
    const isHovering = ref(false)
    const currentWidth = ref(props.width)
    const currentHeight = ref(props.height)

    const stopWatchWidth = watch(
      () => props.width,
      (val) => {
        if (!isResizing.value) currentWidth.value = val
      }
    )
    const stopWatchHeight = watch(
      () => props.height,
      (val) => {
        if (!isResizing.value) currentHeight.value = val
      }
    )

    const startResize = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      isResizing.value = true

      const startX = e.clientX
      const startY = e.clientY
      const startWidth = currentWidth.value
      const startHeight = currentHeight.value

      const minW = props.minWidth !== null ? props.minWidth : -Infinity
      const maxW = props.maxWidth !== null ? props.maxWidth : Infinity
      const minH = props.minHeight !== null ? props.minHeight : -Infinity
      const maxH = props.maxHeight !== null ? props.maxHeight : Infinity

      const onMouseMove = (ev: MouseEvent) => {
        ev.preventDefault()
        let newWidth = startWidth + (ev.clientX - startX)
        let newHeight = startHeight + (ev.clientY - startY)

        newWidth = Math.max(minW, Math.min(maxW, newWidth))
        newHeight = Math.max(minH, Math.min(maxH, newHeight))

        if (props.aspectRatio !== null && props.aspectRatio !== undefined) {
          let newHeightByWidth = newWidth / props.aspectRatio
          newHeight = newHeightByWidth
          newHeight = Math.max(minH, Math.min(maxH, newHeight))
          const newWidthByHeight = newHeight * props.aspectRatio
          newWidth = Math.max(minW, Math.min(maxW, newWidthByHeight))
        }

        currentWidth.value = newWidth
        currentHeight.value = newHeight
        emit('resize', newWidth, newHeight)
      }

      const onMouseUp = () => {
        isResizing.value = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    }

    onUnmounted(() => {
      stopWatchWidth()
      stopWatchHeight()
    })

    return () => {
      const children = slots.default ? slots.default() : []
      const surfaceColor = 'var(--v-theme-on-surface, #000000)'

      const isActive = isResizing.value || isHovering.value
      const bgColor = isActive
        ? `rgba(${surfaceColor}, 0.10)`
        : `rgba(${surfaceColor}, 0.04)`
      const borderColor = isActive
        ? `rgba(${surfaceColor}, 0.25)`
        : `rgba(${surfaceColor}, 0.08)`
      const iconColor = isActive
        ? `rgba(${surfaceColor}, 0.85)`
        : `rgba(${surfaceColor}, 0.40)`
      const scale = isActive ? 1.1 : 1.0

      return h(
        'div',
        {
          ref: containerRef,
          style: {
            display: 'inline-block',
            width: currentWidth.value + 'px',
            height: currentHeight.value + 'px',
            position: 'relative',
            boxSizing: 'border-box',
            overflow: 'hidden',
            borderRadius: '4px',
          },
        },
        [
          ...children,
          h(
            'div',
            {
              style: {
                position: 'absolute',
                bottom: '4px',
                right: '4px',
                width: '22px',
                height: '22px',
                borderRadius: '4px',
                background: bgColor,
                border: `1px solid ${borderColor}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'nwse-resize',
                zIndex: 5,
                transition: 'background 0.2s, border-color 0.2s, transform 0.15s',
                userSelect: 'none',
                transform: `scale(${scale})`,
              },
              onMouseenter: () => { isHovering.value = true },
              onMouseleave: () => { isHovering.value = false },
              onMousedown: startResize,
            },
            [
              h(
                'svg', 
                { 
                  viewBox: '0 0 24 24', 
                  width: '16', 
                  height: '16',
                  style: { /* 你的样式 */ }
                },
                [
                  h('path', { 
                    d: mdiArrowBottomRight, // 直接使用导入的路径数据
                    fill: 'currentColor' // 或你定义的 iconColor
                  })
                ]
              )
            ]
          ),
        ]
      )
    }
  },
})

// ==================== Vue 节点视图 ====================

export const vueComponentNodeView = defineVueNodeView({
  name: 'vueComponent',
  component: defineComponent({
    props: ['node', 'view', 'getPos'],
    setup(props) {
      const node = props.node
      const state = reactive<{
        component: any | null
        constraints: Required<ResizeConstraints>
        loaded: boolean
        error?: string
      }>({
        component: null,
        constraints: { ...DEFAULT_CONSTRAINTS },
        loaded: false,
      })

      const load = async () => {
        const name = node.value.attrs.componentName as string
        try {
          const { component, constraints } = await loadComponent(name)
          state.component = component
          state.constraints = constraints
          state.loaded = true
          state.error = undefined
        } catch (err: any) {
          state.error = err.message || '加载失败'
          state.loaded = true
        }
      }
      load()

      watch(
        () => node.value.attrs.componentName,
        () => {
          state.loaded = false
          load()
        }
      )

      const handleResize = (newWidth: number, newHeight: number) => {
        const { view, getPos } = props
        const pos = getPos()
        if (typeof pos !== 'number') return
        const tr = view.state.tr
        tr.setNodeMarkup(pos, undefined, {
          ...node.value.attrs,
          width: Math.round(newWidth),
          height: Math.round(newHeight),
        })
        view.dispatch(tr)
      }

      return () => {
        const currentNode = node.value
        const componentName = currentNode.attrs.componentName as string
        const componentProps = currentNode.attrs.props as Record<string, any>

        if (!state.loaded) {
          return h('div', { style: { padding: '16px', color: 'rgba(var(--v-theme-on-surface), 0.6)' } }, '加载中...')
        }
        if (state.error || !state.component) {
          return h(
            'div',
            {
              style: {
                color: 'var(--v-theme-error, #b71c1c)',
                padding: '8px',
              },
            },
            `错误：${state.error || '组件未找到'}`
          )
        }

        const Comp = state.component
        const entry = componentMap[componentName]
        const aspectRatio = entry?.aspectRatio ?? null

        // 内部内容容器：强制填充并禁用滚动条
        const innerContent = h(
          'div',
          {
            style: {
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box',
            },
            onMousedown: (e: Event) => e.stopPropagation(),
            onKeydown: (e: Event) => e.stopPropagation(),
          },
          h(Comp, {
            ...componentProps,
            style: {
              ...(componentProps.style || {}),
              width: '100%',
              height: '100%',
            },
          })
        )

        return h(
          ResizableContainer,
          {
            width: currentNode.attrs.width,
            height: currentNode.attrs.height,
            aspectRatio: aspectRatio ?? undefined,
            minWidth: state.constraints.minWidth,
            maxWidth: state.constraints.maxWidth,
            minHeight: state.constraints.minHeight,
            maxHeight: state.constraints.maxHeight,
            onResize: handleResize,
          },
          { default: () => [innerContent] }
        )
      }
    },
  }) as any,
})