import {
  union,
  defineBaseCommands,
  defineBaseKeymap,
  defineCommands,
  defineHistory,
  insertNode,
  setBlockType,
} from '@prosekit/core'
import { defineDoc } from '@prosekit/extensions/doc'
import { defineList } from 'prosekit/extensions/list'
import { defineParagraph } from '@prosekit/extensions/paragraph'
import { defineText } from '@prosekit/extensions/text'
import { defineMath } from 'prosekit/extensions/math'
import { defineHeading } from 'prosekit/extensions/heading'
import { renderKaTeXMathBlock, renderKaTeXMathInline } from './extensions/kateX.ts'
import { definePlaceholder } from '@prosekit/extensions/placeholder'
import {
  bold,
  italic,
  underline,
  strikethrough,
  textColor,
  backgroundColor,
  highlight,
  fontFamily,
  boldKeymap,
  italicKeymap,
  underlineKeymap,
  strikethroughKeymap,
  highlightKeymap,
} from './extensions/formatting'
import { vueComponentNode, vueComponentNodeView } from './extensions/vue-component'
import { defineBlockquote } from 'prosekit/extensions/blockquote'
import { defineSubscript } from 'prosekit/extensions/subscript'
import { defineSuperscript } from 'prosekit/extensions/superscript'

// 自定义命令：注册进 editor.commands 命令链，供父组件统一调用
// （例如 componentRefs.value[id]?.commands?.toggleHeading?.(2)）
const customCommands = defineCommands({
  // 切换标题 / 段落
  toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
    return (state, dispatch) => {
      const node = state.selection.$from.node(state.selection.$from.depth)
      if (node && node.type.name === 'heading' && node.attrs.level === level) {
        return setBlockType({ type: 'paragraph' })(state, dispatch)
      }
      return setBlockType({ type: 'heading', attrs: { level } })(state, dispatch)
    }
  },
  // 插入 Vue 组件节点
  insertVueComponent(componentName: string, props: Record<string, any> = {}) {
    return (state, dispatch, view) => {
      if (!view) return false
      const containerWidth = view.dom.clientWidth || 360
      const defaultWidth = Math.min(360, containerWidth)
      const defaultHeight = 240
      return insertNode({
        type: 'vueComponent',
        attrs: { componentName, props, width: defaultWidth, height: defaultHeight },
      })(state, dispatch)
    }
  },
  // 插入行内公式
  insertMathInline(latex: string) {
    return (state, dispatch) => {
      const node = state.schema.nodes.mathInline?.create({}, state.schema.text(latex))
      if (!node) return false
      const tr = state.tr.replaceSelectionWith(node)
      if (dispatch) dispatch(tr)
      return true
    }
  },
  // 插入块级公式
  insertMathBlock(latex: string) {
    return (state, dispatch) => {
      const node = state.schema.nodes.mathBlock?.create({}, state.schema.text(latex))
      if (!node) return false
      const tr = state.tr.replaceSelectionWith(node)
      if (dispatch) dispatch(tr)
      return true
    }
  },
})

export function defineExtension() {
  return union(
    defineBaseCommands(),
    defineDoc(),
    defineParagraph(),
    defineText(),
    defineBaseKeymap(),
    defineHistory(),
    defineHeading(),
    definePlaceholder({ placeholder: '写点什么吧' }),
    defineList(),
    defineBlockquote(),
    defineSubscript(),
    defineSuperscript(),
    defineMath({ renderMathBlock: renderKaTeXMathBlock, renderMathInline: renderKaTeXMathInline }),
    bold,
    italic,
    underline,
    strikethrough,
    textColor,
    backgroundColor,
    highlight,
    fontFamily,
    // 快捷键
    boldKeymap,
    italicKeymap,
    underlineKeymap,
    strikethroughKeymap,
    highlightKeymap,
    vueComponentNode,
    vueComponentNodeView,
    customCommands,
  )
}
export type EditorExtension = ReturnType<typeof defineExtension>