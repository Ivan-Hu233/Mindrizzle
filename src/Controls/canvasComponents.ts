import type { NodeJSON } from '@prosekit/core'
import type { EditorCommands } from './RichEditor/extension.ts'
import RichTextEditor from './RichEditor/RichTextEditor.vue'
import EditableCodeBlock from './EditorComponents/EditableCodeBlock.vue'
import { CODE_BLOCK_CONSTRAINTS, RICH_TEXT_CONSTRAINTS } from './componentConstraints.ts'
import { normalizeConstraints, type ResizeConstraints } from './resizeConstraints.ts'

export interface RichTextConfig {
  content: NodeJSON | null
  autoHeight?: boolean
}

export interface CodeBlockConfig {
  code: string
  language: string
}

export type WidgetConfig = RichTextConfig | CodeBlockConfig
export type ComponentKey = 'RichTextEditor' | 'EditableCodeBlock'

export interface ComponentController {
  saveConfig?: () => Partial<WidgetConfig>
  loadConfig?: (config: WidgetConfig) => void
  commands?: EditorCommands
  resolveDropAtElement?: (el: HTMLElement | null, preferBefore: boolean) => number | null
  scrollContent?: (deltaY: number) => void
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasItem {
  id: string
  component: ComponentKey
  config: WidgetConfig
  layout: {
    desktop: Rect
    mobile: Rect
  }
  arranged: {
    desktop: boolean
    mobile: boolean
  }
}

export interface AddableComponentMeta {
  key: ComponentKey
  label: string
  addId: string
  defaultConfig: () => WidgetConfig
  defaultSize: { w: number; h: number }
}

export const componentMap = {
  RichTextEditor,
  EditableCodeBlock,
}

export const ADDABLE_COMPONENTS: AddableComponentMeta[] = [
  {
    key: 'RichTextEditor',
    label: '富文本',
    addId: 'add-rich',
    defaultConfig: () => ({ content: null }),
    defaultSize: { w: 400, h: 300 },
  },
  {
    key: 'EditableCodeBlock',
    label: '代码块',
    addId: 'add-code',
    defaultConfig: () => ({
      code: '// 在此编写代码',
      language: 'javascript',
    }),
    defaultSize: { w: 400, h: 250 },
  },
]

export const componentMetaOf = (key: ComponentKey) =>
  ADDABLE_COMPONENTS.find((component) => component.key === key)

export const componentLabelOf = (key: ComponentKey) =>
  componentMetaOf(key)?.label ?? key

const componentConstraints: Partial<Record<ComponentKey, ResizeConstraints>> = {
  RichTextEditor: RICH_TEXT_CONSTRAINTS,
  EditableCodeBlock: CODE_BLOCK_CONSTRAINTS,
}

const CANVAS_DEFAULT_CONSTRAINTS: Required<ResizeConstraints> = {
  minWidth: 100,
  maxWidth: null,
  minHeight: 100,
  maxHeight: null,
}

export const constraintsOf = (item: Pick<CanvasItem, 'component'>): Required<ResizeConstraints> => {
  const raw = componentConstraints[item.component]
  return raw ? normalizeConstraints(raw) : CANVAS_DEFAULT_CONSTRAINTS
}
