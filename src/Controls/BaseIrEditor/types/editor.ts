import type { Ref, Component } from 'vue'

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
  /** 组件映射表，用于反序列化时查找组件定义 */
  components?: Record<string, Component>
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
  /** 
   * 插入一个 Vue 组件（会自动注册，如果组件没有 name 则生成唯一名称）
   * @param component 组件定义或已注册的名称
   * @param props 传递给组件的 props
   * @returns 组件的 UUID（可用于后续更新或移除）
   */
  insertVueComponent: (component: Component | string, props?: Record<string, any>) => string
  /** 注册一个组件，供序列化/反序列化使用 */
  registerComponent: (name: string, component: Component) => void
  /** 更新已插入组件的 props */
  updateComponentProps: (uuid: string, props: Record<string, any>) => void
  /** 移除已插入的组件（从 DOM 移除并销毁实例） */
  removeComponent: (uuid: string) => void
}

// useIrEditor 组合式函数的参数类型
export type UseIrEditorProps = EditorProps

// useIrEditor 组合式函数的返回值类型
export interface UseIrEditorReturn extends EditorExposed {
  editorRef: Ref<HTMLElement | null>
  innerHtml: Ref<string>
  isEmpty: Ref<boolean>

  saveSelection: () => void
  restoreSelection: () => void

  handleInput: (e: Event) => void
  handleKeydown: (e: KeyboardEvent) => void

  mountAllComponents: () => void
}