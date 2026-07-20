// vue-component.ts
import { defineNodeSpec } from '@prosekit/core'
import { defineVueNodeView } from '@prosekit/vue'
import { h, defineAsyncComponent, defineComponent } from 'vue'

/**
 * 注册可用的 Vue 组件映射表（支持异步组件）
 * 根据实际组件路径添加更多组件，key 为组件名称（与 insertVueComponent 的 componentName 一致）
 */
const componentMap: Record<string, any> = {
  CodeBlock: defineAsyncComponent(() => import('../../EditorPlugin/EditableCodeBlock.vue')),
  // 按需添加更多组件，例如：
  // MyCard: defineAsyncComponent(() => import('../../components/MyCard.vue')),
}

// 节点规范定义
export const vueComponentNode = defineNodeSpec({
  name: 'vueComponent',
  group: 'block',
  atom: true,
  isolating: true,
  attrs: {
    componentName: { default: 'MyCard' },
    props: { default: {} },
  },
  parseDOM: [
    {
      tag: 'div[data-vue-component]',
      getAttrs(dom) {
        const el = dom as HTMLElement
        return {
          componentName: el.getAttribute('data-component-name') || 'MyCard',
          props: JSON.parse(el.getAttribute('data-props') || '{}'),
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
      },
    ]
  },
})

// Vue 节点视图
export const vueComponentNodeView = defineVueNodeView({
  name: 'vueComponent',
  component: defineComponent({
    // 必须声明从 ProseKit 传入的 props
    props: ['node', 'view', 'getPos'],
    setup(props) {
      return () => {
        // props.node 是一个 ShallowRef<Node>，需要通过 .value 访问
        const node = props.node.value
        const componentName = node.attrs.componentName as string
        const componentProps = node.attrs.props as Record<string, any>
        const Comp = componentMap[componentName]

        if (!Comp) {
          console.warn(`Vue component "${componentName}" not found in componentMap`)
          return h('div', 'Unknown component')
        }

        // 外层容器：阻止鼠标和键盘事件冒泡，避免组件内部交互导致编辑器误操作（如删除节点）
        return h(
          'div',
          {
            onMousedown: (e: Event) => e.stopPropagation(),
            onKeydown: (e: Event) => e.stopPropagation(),
            onKeyup: (e: Event) => e.stopPropagation(),
            // 根据实际需要，也可以阻止其他事件，如 click、dblclick 等
          },
          h(Comp, componentProps)
        )
      }
    },
  }) as any,
})