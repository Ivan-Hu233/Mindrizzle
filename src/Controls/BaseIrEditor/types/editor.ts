import type { Ref } from 'vue'

// 组件 Props
export interface EditorProps {
  /** HTML 内容（v-model） */
  modelValue?: string
  /** 占位文本 */
  placeholder?: string
  /** 最小高度（CSS 值） */
  minHeight?: string
  /** 最大高度（CSS 值，超出滚动） */
  maxHeight?: string
  /** 是否禁用编辑 */
  disabled?: boolean
}

// 组件 Emits
export interface EditorEmits {
  /** 内容变化时触发，更新 v-model */
  (e: 'update:modelValue', html: string): void
  /** 编辑器获得焦点 */
  (e: 'focus', event: FocusEvent): void
  /** 编辑器失去焦点 */
  (e: 'blur', event: FocusEvent): void
  /** 选区变化时触发 */
  (e: 'selectionChange', range: Range | null): void
}


// 组件暴露的公共方法（defineExpose）

export interface EditorExposed {
  /** 聚焦编辑器 */
  focus: () => void
  /** 失焦编辑器 */
  blur: () => void
  /** 获取当前 HTML 内容 */
  getHtml: () => string
  /** 设置 HTML 内容（替换全部） */
  setHtml: (html: string) => void

  // 格式化命令（作用于当前选区）
  applyBold: () => void
  applyItalic: () => void
  applyUnderline: () => void
  applyStrikeThrough: () => void
  /** 设置文字颜色（CSS 颜色值） */
  applyColor: (color: string) => void
  /** 设置背景高亮（默认 #FFEB3B） */
  applyHighlight: (color?: string) => void
  /** 设置字号（像素值） */
  applyFontSize: (size: number) => void
  /** 应用任意内联样式对象 */
  applyInlineStyle: (style: Record<string, string>) => void
  /** 清除选区所有格式 */
  applyClearFormat: () => void

  /** 在光标处插入 HTML 片段 */
  insertHtml: (html: string) => void
  /** 在光标处插入纯文本 */
  insertText: (text: string) => void
}

// useIrEditor 组合式函数的参数类型
export type UseIrEditorProps = EditorProps

// useIrEditor 组合式函数的返回值类型
export interface UseIrEditorReturn extends EditorExposed {
  editorRef: Ref<HTMLElement | null>
  innerHtml: Ref<string>

  saveSelection: () => void
  restoreSelection: () => void

  handleInput: (e: Event) => void
  handleKeydown: (e: KeyboardEvent) => void
}