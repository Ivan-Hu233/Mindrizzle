import {
  union,
  createEditor,
  defineBaseCommands,
  defineBaseKeymap,
  defineCommands,
  defineHistory,
  insertNode,
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

// 父组件统一经 editor.commands 命令链调用（如 componentRefs.value[id]?.commands?.toggleHeading?.({ level })），注册自定义命令
// 注：标题切换复用 defineHeading() 内置的 toggleHeading({ level })，避免同名命令被合并成交叉类型
const customCommands = defineCommands({
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
  insertMathInline(latex: string) {
    return (state, dispatch) => {
      const node = state.schema.nodes.mathInline?.create({}, state.schema.text(latex))
      if (!node) return false
      const tr = state.tr.replaceSelectionWith(node)
      if (dispatch) dispatch(tr)
      return true
    }
  },
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
// 父组件统一经 editor.commands 命令链调用（含自定义与各扩展命令）且要 IDE 补全，
// 直接以 createEditor 实例的 commands 推导精确命令类型，而非手写宽泛索引签名
export type EditorCommands = ReturnType<typeof createEditor<EditorExtension>>['commands']