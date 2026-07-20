import { defineNodeSpec } from '@prosekit/core'
import { defineVueNodeView } from '@prosekit/vue'
import { h, defineAsyncComponent, defineComponent, ref, onUnmounted } from 'vue'

// 注册可用的 Vue 组件映射表（支持异步组件）
const componentMap: Record<string, any> = {
  CodeBlock: defineAsyncComponent(() => import('../../EditorPlugin/EditableCodeBlock.vue')),
  // 按需添加更多组件
}

// 节点定义：支持 float 属性实现文字环绕
export const vueComponentNode = defineNodeSpec({
  name: 'vueComponent',
  group: 'block',
  atom: true,
  isolating: true,
  attrs: {
    componentName: { default: 'MyCard' },
    props: { default: {} },
    float: { default: 'none' }, // 'left' | 'right' | 'none'
  },
  parseDOM: [
    {
      tag: 'div[data-vue-component]',
      getAttrs(dom) {
        const el = dom as HTMLElement
        return {
          componentName: el.getAttribute('data-component-name') || 'MyCard',
          props: JSON.parse(el.getAttribute('data-props') || '{}'),
          float: el.getAttribute('data-float') || 'none',
        }
      },
    },
  ],
  toDOM(node) {
    const float = node.attrs.float || 'none'
    const style = `float: ${float}; margin: 8px;`
    return [
      'div',
      {
        'data-vue-component': '',
        'data-component-name': node.attrs.componentName,
        'data-props': JSON.stringify(node.attrs.props),
        'data-float': float,
        style,
      },
    ]
  },
})

// Vue 节点视图：渲染自定义组件 + 左上角拖拽手柄
export const vueComponentNodeView = defineVueNodeView({
  name: 'vueComponent',
  component: defineComponent({
    props: ['node', 'view', 'getPos'],
    setup(props) {
      // 拖拽状态
      const isDragging = ref(false)
      const startX = ref(0)
      const startY = ref(0)
      const currentFloat = ref<string>('none')

      // 鼠标事件处理
      const onHandleMouseDown = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        isDragging.value = true
        startX.value = e.clientX
        startY.value = e.clientY
        currentFloat.value = props.node.value.attrs.float || 'none'
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      }

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging.value) return
        const deltaX = e.clientX - startX.value
        const deltaY = e.clientY - startY.value
        // 判断主要方向：水平移动大于垂直移动则切换左右
        const absX = Math.abs(deltaX)
        const absY = Math.abs(deltaY)
        let newFloat = currentFloat.value
        if (absX > absY && absX > 10) {
          // 水平拖拽
          newFloat = deltaX > 0 ? 'right' : 'left'
        } else if (absY > absX && absY > 10) {
          // 垂直向上拖拽取消浮动，向下不变（或可自定义）
          if (deltaY < 0) {
            newFloat = 'none'
          }
        }
        // 如果浮动方向改变，则更新节点属性
        if (newFloat !== currentFloat.value) {
          const { state, dispatch } = props.view
          const pos = props.getPos()
          const tr = state.tr.setNodeAttribute(pos, 'float', newFloat)
          dispatch(tr)
          currentFloat.value = newFloat
          // 重置起始位置，避免连续触发
          startX.value = e.clientX
          startY.value = e.clientY
        }
      }

      const onMouseUp = () => {
        isDragging.value = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      onUnmounted(() => {
        // 清理事件
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      })

      return () => {
        const node = props.node.value
        const componentName = node.attrs.componentName as string
        const componentProps = node.attrs.props as Record<string, any>
        const Comp = componentMap[componentName]
        if (!Comp) {
          console.warn(`Vue component "${componentName}" not found in componentMap`)
          return h('div', { style: 'color: red;' }, `Unknown component: ${componentName}`)
        }

        // 渲染带手柄的容器
        return h(
          'div',
          {
            style: 'position: relative; display: inline-block;',
            // 阻止内部事件冒泡到编辑器
            onMousedown: (e: Event) => e.stopPropagation(),
            onKeydown: (e: Event) => e.stopPropagation(),
            onKeyup: (e: Event) => e.stopPropagation(),
          },
          [
            // 自定义组件
            h(Comp, componentProps),
            // 左上角三角形拖拽手柄（绝对定位，不增加尺寸）
            h(
              'div',
              {
                style: `
                  position: absolute;
                  top: -6px;
                  left: -6px;
                  width: 16px;
                  height: 16px;
                  cursor: grab;
                  user-select: none;
                  z-index: 10;
                `,
                onMousedown: onHandleMouseDown,
              },
              // 使用 CSS 绘制三角形（纯 CSS）
              h('div', {
                style: `
                  width: 0;
                  height: 0;
                  border-left: 16px solid rgba(0, 0, 0, 0.3);
                  border-top: 16px solid transparent;
                  border-bottom: 16px solid transparent;
                  transform: rotate(45deg);
                  pointer-events: none; /* 使点击事件由父容器捕获 */
                `,
              })
            ),
          ]
        )
      }
    },
  }) as any,
})