<template>
  <v-card class="ir-editor-wrapper" :class="{ 'ir-disabled': disabled }">
    <div
      ref="editorRef"
      class="ir-editor-content text-body-1 pa-3"
      :class="{ 'is-empty': isEmpty }"
      :style="{ minHeight, maxHeight }"
      :contenteditable="!disabled"
      :data-placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
      @focus="onFocus"
      @blur="onBlur"
    />
  </v-card>
</template>

<script setup lang="ts">
import { useIrEditor } from './composables/useIrEditor'
import DOMPurify from 'dompurify'

// 导入公共类型
import type { EditorProps, EditorEmits, EditorExposed } from './types/editor'

// Props & Emits
const props = withDefaults(defineProps<EditorProps>(), {
  modelValue: '',
  placeholder: '请输入',
  minHeight: '120px',
  maxHeight: '600px',
  disabled: false,
  components: () => ({}),
})

const emit = defineEmits<EditorEmits>()

// 使用 useIrEditor
const {
  editorRef,          // contenteditable 元素的 DOM 引用
  innerHtml,          // 当前 HTML 内容的响应式引用
  isEmpty,
  applyBold,
  applyItalic,
  applyUnderline,
  applyStrikeThrough,
  applyColor,
  applyHighlight,
  applyFontSize,
  applyInlineStyle,
  applyClearFormat,
  insertHtml,
  insertText,
  getHtml,
  setHtml,
  focus,
  blur,
  saveSelection,
  restoreSelection,
  handleInput,        // 由模板 @input 调用
  handleKeydown,      // 由模板 @keydown 调用
  insertVueComponent,
  registerComponent,
  updateComponentProps,
  removeComponent,
} = useIrEditor(props, emit)

// Provider
const editorContext = { insertText, insertHtml, getHtml }
provide('editorContext', editorContext)

// 本地事件处理
const onInput = (e: Event) => {
  handleInput(e)
}

const onKeydown = (e: KeyboardEvent) => {
  handleKeydown(e)
}

/** 粘贴事件：过滤不安全内容后调用 useIrEditor.insertHtml */
const onPaste = (e: ClipboardEvent) => {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/html') || e.clipboardData?.getData('text/plain')
  if (!text) return

  const sanitized = DOMPurify.sanitize(text, {
    ALLOWED_TAGS: [
      'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'span', 'div', 'p', 'br',
      'ul', 'ol', 'li', 'a', 'blockquote',
    ],
    ALLOWED_ATTR: ['style', 'href', 'target'],
    ALLOWED_STYLES: [
      'color', 'background-color', 'font-size',
      'text-decoration', 'font-weight', 'font-style',
    ],
  } as any) as unknown as string

  insertHtml(sanitized)
}

const onFocus = (e: FocusEvent) => {
  emit('focus', e)
}

const onBlur = (e: FocusEvent) => {
  emit('blur', e)
}

// 暴露公共 API
defineExpose<EditorExposed>({
  focus,
  blur,
  getHtml,
  setHtml,
  applyBold,
  applyItalic,
  applyUnderline,
  applyStrikeThrough,
  applyColor,
  applyHighlight,
  applyFontSize,
  applyInlineStyle,
  applyClearFormat,
  insertHtml,
  insertText,
  insertVueComponent,
  registerComponent,
  updateComponentProps,
  removeComponent,
})
import './styles/ir-editor.scss'
import { provide } from 'vue'
</script>