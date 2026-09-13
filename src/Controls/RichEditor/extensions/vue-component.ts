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
  markRaw,
} from 'vue'
import { mdiArrowBottomRight, mdiExportVariant } from '@mdi/js'
import { DEFAULT_CONSTRAINTS, normalizeConstraints, type ResizeConstraints } from '../../resizeConstraints.ts'
import { createStoreResolver, findPositionerEl } from './blockHandleUtils.ts'

const resolveBlockHandleStore = createStoreResolver()

interface ComponentEntry {
  loader: () => Promise<{
    default: any
    resizeConstraints?: ResizeConstraints
  }>
  aspectRatio?: number | null
}

const componentMap: Record<string, ComponentEntry> = {
  CodeBlock: {
    loader: () => import('../../EditorComponents/EditableCodeBlock.vue'),
  },
}

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
  const constraints = normalizeConstraints(module.resizeConstraints)
  const result = { component: comp, constraints }
  loadedCache.set(name, result)
  return result
}

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

interface CornerButtonOptions {
  icon: string
  active: boolean
  cursor: string
  at: { left?: string; right?: string; bottom: string }
  onMousedown: (event: MouseEvent) => void
  onHover: (hovering: boolean) => void
}

// 左下“拖出成块”与右下缩放共用同一角标视觉（hover/拖拽中提亮并放大），
// 避免渲染函数里重复整段样式
const cornerButtonStyle = (active: boolean, cursor: string, at: CornerButtonOptions['at']) => {
  const tone = 'var(--v-theme-on-surface, #000000)'
  return {
    position: 'absolute' as const,
    ...at,
    width: '22px',
    height: '22px',
    borderRadius: '4px',
    background: active ? `rgba(${tone}, 0.10)` : `rgba(${tone}, 0.04)`,
    border: `1px solid ${active ? `rgba(${tone}, 0.25)` : `rgba(${tone}, 0.08)`}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor,
    zIndex: 5,
    transition: 'background 0.2s, border-color 0.2s, transform 0.15s',
    userSelect: 'none',
    transform: `scale(${active ? 1.1 : 1})`,
  }
}

function renderCornerButton(options: CornerButtonOptions) {
  const { icon, active, cursor, at, onMousedown, onHover } = options
  const tone = 'var(--v-theme-on-surface, #000000)'
  const iconColor = active ? `rgba(${tone}, 0.85)` : `rgba(${tone}, 0.40)`
  return h(
    'div',
    {
      style: cornerButtonStyle(active, cursor, at),
      onMouseenter: () => onHover(true),
      onMouseleave: () => onHover(false),
      onMousedown,
    },
    [
      h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, style: { color: iconColor } }, [
        h('path', { d: icon, fill: 'currentColor' }),
      ]),
    ],
  )
}

// 拖出成块时跟随鼠标的徽标，仅作“正在拖出”反馈，不可命中
function createExtractGhost(): HTMLDivElement {
  const ghost = document.createElement('div')
  ghost.style.cssText =
    'position:fixed;pointer-events:none;z-index:9999;width:26px;height:26px;border-radius:4px;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:rgba(var(--v-theme-surface),0.92);' +
    'border:1px solid rgba(var(--v-theme-on-surface),0.3);color:rgba(var(--v-theme-on-surface),0.6);'
  ghost.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="${mdiExportVariant}" fill="currentColor"/></svg>`
  return ghost
}

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
    // 内容经 prop 传入而非 slot：NodeView 渲染上下文外调用 slot 会触发 Vue 警告
    content: { type: Object as PropType<any>, required: true },
  },
  emits: ['resize', 'extract'],
  setup(props, { emit }) {
    const containerRef = ref<HTMLElement | null>(null)
    const isResizing = ref(false)
    const isResizeHovered = ref(false)
    const isExtractHovered = ref(false)
    const isExtracting = ref(false)
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
        document.removeEventListener('mousemove', onMouseMove, true)
        document.removeEventListener('mouseup', onMouseUp)
      }

      // 捕获阶段：编辑器 hover 自解析在 zoom≠1 时会 stopPropagation，冒泡监听会收不到
      document.addEventListener('mousemove', onMouseMove, true)
      document.addEventListener('mouseup', onMouseUp)
    }

    // 左下角按钮：把插入组件拖出富文本重新变回画布块，是否落位由画布判定（同步回填 accepted）
    const startExtract = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      isExtracting.value = true
      const ghost = createExtractGhost()
      document.body.appendChild(ghost)
      const placeGhost = (ev: MouseEvent) => {
        ghost.style.left = `${ev.clientX + 12}px`
        ghost.style.top = `${ev.clientY + 12}px`
      }
      const onMouseMove = (ev: MouseEvent) => placeGhost(ev)
      const onMouseUp = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove, true)
        document.removeEventListener('mouseup', onMouseUp)
        ghost.remove()
        isExtracting.value = false
        emit('extract', { clientX: ev.clientX, clientY: ev.clientY })
      }
      placeGhost(event)
      // 捕获阶段：编辑器 hover 自解析在 zoom≠1 时会 stopPropagation，冒泡监听会收不到
      document.addEventListener('mousemove', onMouseMove, true)
      document.addEventListener('mouseup', onMouseUp)
    }

    onUnmounted(() => {
      stopWatchWidth()
      stopWatchHeight()
    })

    return () => {
      const children = [props.content]
      const isResizeActive = isResizing.value || isResizeHovered.value
      const isExtractActive = isExtracting.value || isExtractHovered.value

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
          renderCornerButton({
            icon: mdiExportVariant,
            active: isExtractActive,
            cursor: 'grab',
            at: { left: '4px', bottom: '4px' },
            onMousedown: startExtract,
            onHover: (hovering) => { isExtractHovered.value = hovering },
          }),
          renderCornerButton({
            icon: mdiArrowBottomRight,
            active: isResizeActive,
            cursor: 'nwse-resize',
            at: { right: '4px', bottom: '4px' },
            onMousedown: startResize,
            onHover: (hovering) => { isResizeHovered.value = hovering },
          }),
        ],
      )
    }
  },
})

export const vueComponentNodeView = defineVueNodeView({
  name: 'vueComponent',
  component: defineComponent({
    props: ['node', 'view', 'getPos'],
    setup(props) {
      const node = props.node
      const view = props.view
      const getPos = props.getPos
      let hoverKeepAlive: ReturnType<typeof setInterval> | null = null

      const setBlockHover = () => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        const store = resolveBlockHandleStore(findPositionerEl(view))
        store?.hoverState?.set({ node: node.value, pos })
      }

      const notifyBlockHover = () => {
        setBlockHover()
        if (hoverKeepAlive) return
        hoverKeepAlive = setInterval(setBlockHover, 150)
      }

      const stopBlockHover = () => {
        if (!hoverKeepAlive) return
        clearInterval(hoverKeepAlive)
        hoverKeepAlive = null
      }

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
          state.component = markRaw(component)
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

      // 首次取 clientWidth 可能为 0，以 10000 作较大后备避免宽度塌缩
      const containerWidth = ref<number>(view.dom.clientWidth || 10000)
      let resizeObserver: ResizeObserver | null = null

      onMounted(() => {
        const container = view.dom
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
        stopBlockHover()
        if (resizeObserver) {
          resizeObserver.disconnect()
          resizeObserver = null
        }
      })

      const effectiveMaxWidth = computed(() => {
        const constraintsMax = state.constraints.maxWidth
        const containerW = containerWidth.value

        if (constraintsMax === null) {
          return containerW
        }
        return Math.min(constraintsMax, containerW)
      })

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

      const updateComponentProps = (props: Record<string, any>) => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        const tr = view.state.tr
        tr.setNodeMarkup(pos, undefined, {
          ...node.value.attrs,
          props: { ...node.value.attrs.props, ...props },
        })
        view.dispatch(tr)
      }

      // 左下按钮拖出成块：由画布判定是否落位（编辑态 + 落在画布内）并同步回填 accepted，
      // 落位成功后从文档删除该节点（画布块已接管其内容）
      const handleExtract = (point: { clientX: number; clientY: number }) => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        // doc 需 block+，仅剩该节点时抽出会留下非法空文档，直接不响应
        if (view.state.doc.childCount <= 1) return
        const payload = {
          componentName: node.value.attrs.componentName as string,
          props: node.value.attrs.props as Record<string, any>,
          clientX: point.clientX,
          clientY: point.clientY,
          accepted: false,
        }
        window.dispatchEvent(new CustomEvent('Mindrizzle:extract-component', { detail: payload }))
        if (!payload.accepted) return
        view.dispatch(view.state.tr.delete(pos, pos + node.value.nodeSize))
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
            onPointermove: notifyBlockHover,
            onPointerenter: notifyBlockHover,
            onPointerover: notifyBlockHover,
            onPointerleave: stopBlockHover,
          },
          h(Comp, {
            ...componentProps,
            'onUpdate:modelValue': (value: string) => updateComponentProps({ modelValue: value }),
            'onUpdate:language': (value: string) => updateComponentProps({ language: value }),
            style: {
              ...(componentProps.style || {}),
              width: '100%',
              height: '100%',
            },
          })
        )

        // ResizableContainer 以 null 表示无限制，这里始终传数字以确保限制生效
        return h(
          ResizableContainer,
          {
            width: currentNode.attrs.width,
            height: currentNode.attrs.height,
            aspectRatio: aspectRatio ?? undefined,
            minWidth: state.constraints.minWidth,
            maxWidth: effectiveMaxWidth.value,
            minHeight: state.constraints.minHeight,
            maxHeight: state.constraints.maxHeight,
            onResize: handleResize,
            onExtract: handleExtract,
            content: innerContent,
          }
        )
      }
    },
  }) as any,
})