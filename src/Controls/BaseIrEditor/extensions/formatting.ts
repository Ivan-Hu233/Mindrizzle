import { defineBold, defineBoldKeymap } from '@prosekit/extensions/bold'
import { defineItalic, defineItalicKeymap } from '@prosekit/extensions/italic'
import { defineUnderline, defineUnderlineKeymap } from '@prosekit/extensions/underline'
import { defineStrike, defineStrikeKeymap } from '@prosekit/extensions/strike'
import { defineTextColor } from '@prosekit/extensions/text-color'
import { defineBackgroundColor } from '@prosekit/extensions/background-color'
import { defineHighlight, defineHighlightKeymap } from '@prosekit/extensions/highlight'
import { defineFontFamily } from '@prosekit/extensions/font-family'

// 扩展实例（已实例化）
export const bold = defineBold()
export const italic = defineItalic()
export const underline = defineUnderline()
export const strikethrough = defineStrike()
export const textColor = defineTextColor()
export const backgroundColor = defineBackgroundColor()
export const highlight = defineHighlight()
export const fontFamily = defineFontFamily()

// 快捷键扩展
export const boldKeymap = defineBoldKeymap()
export const italicKeymap = defineItalicKeymap()
export const underlineKeymap = defineUnderlineKeymap()
export const strikethroughKeymap = defineStrikeKeymap()
export const highlightKeymap = defineHighlightKeymap()
