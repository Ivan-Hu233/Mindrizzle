import { defineNodeSpec } from '@prosekit/core'
import { defineVueNodeView } from '@prosekit/vue'
import {
  h,
  defineComponent,
  ref,
  watch,
  onUnmounted,
  reactive,
  PropType,
  onMounted,
  computed,
} from 'vue'
import { mdiArrowBottomRight } from '@mdi/js'
import { normalizeConstraints, type ResizeConstraints } from '../../resizeConstraints'

// ==================== 类型定义 ====================

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

// ==================== 加载与缓存 ====================

const loadedCache = new Map<
  string,
  { component: any; constraints: Required<ResizeConstraints> }
>()

async function loadComponent(name: string) {
  if (loadedCache.has(name)) return loadedCache.get(name)!
  const entry = componentMap[name]
  if (!entry) throw new Error(`未知组件：${name}`)
  const module = await entry.loader()
  const comp = module.default
  // 统一通过 normalizeConstraints 处理：undefined → 默认，null → 无限制
  const constraints = normalizeConstraints(module.resizeConstraints)
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

      // 如果 maxWidth 为 null，则视为无限制（使用 Infinity）
      const maxW = props.maxWidth !== null ? props.maxWidth : Infinity
      const minW = props.minWidth !== null ? props.minWidth : -Infinity
      const maxH = props.maxHeight !== null ? props.maxHeight : Infinity
      const minH = props.minHeight !== null ? props.minHeight : -Infinity

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
            maxWidth: props.maxWidth !== null ? props.maxWidth + 'px' : '100%',
            maxHeight: props.maxHeight !== null ? props.maxHeight + 'px' : '100%',
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
                transition:
                  'background 0.2s, border-color 0.2s, transform 0.15s',
                userSelect: 'none',
                transform: `scale(${scale})`,
              },
              onMouseenter: () => {
                isHovering.value = true
              },
              onMouseleave: () => {
                isHovering.value = false
              },
              onMousedown: startResize,
            },
            [
              h(
                'svg',
                {
                  viewBox: '0 0 24 24',
                  width: '16',
                  height: '16',
                  style: { color: iconColor },
                },
                [
                  h('path', {
                    d: mdiArrowBottomRight,
                    fill: 'currentColor',
                  }),
                ]
              ),
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
      const view = props.view
      const getPos = props.getPos

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

      // ---------- 监听容器宽度（编辑区域） ----------
      // 初始值：直接取 view.dom.clientWidth，若为 0 则给一个较大后备（如 10000）
      const containerWidth = ref<number>(view.dom.clientWidth || 10000)
      let resizeObserver: ResizeObserver | null = null

      onMounted(() => {
        const container = view.dom // ProseMirror 内容元素
        if (container) {
          containerWidth.value = container.clientWidth || 10000
          resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
              containerWidth.value = entry.contentRect.width || 10000
            }
          })
          resizeObserver.observe(container)
        }
      })

      onUnmounted(() => {
        if (resizeObserver) {
          resizeObserver.disconnect()
          resizeObserver = null
        }
      })

      // 有效最大宽度：取组件约束 maxWidth 与容器宽度的较小值，始终为数字
      const effectiveMaxWidth = computed(() => {
        const constraintsMax = state.constraints.maxWidth // 可能为 null
        const containerW = containerWidth.value

        // 容器宽度总是有效数字（初始有后备值）
        if (constraintsMax === null) {
          return containerW
        }
        return Math.min(constraintsMax, containerW)
      })

      // 当有效最大宽度发生变化时，若当前宽度超出，则自动缩小
      const handleResize = (newWidth: number, newHeight: number) => {
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

      watch(
        [effectiveMaxWidth, () => node.value.attrs.width],
        ([maxW, currentW]) => {
          if (maxW < currentW) {
            const newWidth = Math.floor(maxW)
            const currentHeight = node.value.attrs.height
            handleResize(newWidth, currentHeight)
          }
        },
        { immediate: true }
      )
      // ---------- 新增部分结束 ----------

      return () => {
        const currentNode = node.value
        const componentName = currentNode.attrs.componentName as string
        const componentProps = currentNode.attrs.props as Record<string, any>

        if (!state.loaded) {
          return h(
            'div',
            {
              style: {
                padding: '16px',
                color: 'rgba(var(--v-theme-on-surface), 0.6)',
              },
            },
            '加载中...'
          )
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

        // 始终传递数字（不传 null），确保限制生效
        return h(
          ResizableContainer,
          {
            width: currentNode.attrs.width,
            height: currentNode.attrs.height,
            aspectRatio: aspectRatio ?? undefined,
            minWidth: state.constraints.minWidth,
            maxWidth: effectiveMaxWidth.value, // 保证是数字
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