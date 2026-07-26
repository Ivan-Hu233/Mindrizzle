import {
  union,
  defineBaseCommands,
  defineBaseKeymap,
  defineHistory,
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
  )
}
export type EditorExtension = ReturnType<typeof defineExtension>