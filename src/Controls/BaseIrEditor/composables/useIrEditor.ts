import {
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  type Ref,
} from 'vue'

import type { UseIrEditorProps, UseIrEditorReturn } from '../types/editor'

import { execCommand } from '../commands/execCommands'
import {
  customApplyFontSize,
  customApplyInlineStyle,
  customApplyHighlight,
} from '../commands/customCommands'

export function useIrEditor(
  props: UseIrEditorProps,
  emit: (event: any, ...args: any[]) => void
): UseIrEditorReturn {
  // ---------- 状态 ----------
  const editorRef = ref<HTMLElement | null>(null)
  const innerHtml = ref<string>(props.modelValue || '')
  const savedRange = ref<Range | null>(null) // 保存的选区 Range

  // 内部标志，防止循环更新
  let isUpdatingFromInternal = false

  // ---------- 选区管理 ----------
  /**
   * 保存当前选区
   */
  const saveSelection = (): void => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      // 克隆 range 以便后续恢复
      savedRange.value = range.cloneRange()
    } else {
      savedRange.value = null
    }
  }

  /**
   * 恢复之前保存的选区
   * 若恢复失败，将光标置于编辑器末尾
   */
  const restoreSelection = (): void => {
    if (!editorRef.value) return

    const range = savedRange.value
    if (range) {
      try {
        // 尝试重新选择保存的 range
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        return
      } catch (_) {
        // 恢复失败，fallback 到末尾
      }
    }
    // 无有效选区，将光标移到末尾
    const el = editorRef.value
    const sel = window.getSelection()
    if (sel) {
      const newRange = document.createRange()
      newRange.selectNodeContents(el)
      newRange.collapse(false) // 折叠到末尾
      sel.removeAllRanges()
      sel.addRange(newRange)
    }
  }

  // ---------- 同步外部 modelValue ----------
  // 监听外部 modelValue 变化，更新 DOM（并恢复选区）
  watch(
    () => props.modelValue,
    (newVal) => {
      if (isUpdatingFromInternal) return
      const val = newVal || ''
      if (innerHtml.value !== val) {
        innerHtml.value = val
        if (editorRef.value) {
          // 更新前保存选区
          saveSelection()
          editorRef.value.innerHTML = val
          // 更新后恢复选区
          nextTick(() => restoreSelection())
        }
      }
    },
    { immediate: true }
  )
  
  // 当 editorRef 挂载时，设置初始内容并聚焦
  watch(
    editorRef,
    (el) => {
      if (el) {
        el.innerHTML = innerHtml.value
        // 初始光标放在开头（可改为末尾）
        const sel = window.getSelection()
        if (sel) {
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
        }
      }
    },
    { immediate: true }
  )

  // ---------- 输入事件处理 ----------
  const handleInput = (e: Event): void => {
    if (!editorRef.value) return
    const html = editorRef.value.innerHTML
    if (innerHtml.value !== html) {
      isUpdatingFromInternal = true
      innerHtml.value = html
      emit('update:modelValue', html)
      emit('selectionChange', getCurrentRange())
      nextTick(() => {
        isUpdatingFromInternal = false
      })
    }
  }

  //键盘事件处理
  const handleKeydown = (e: KeyboardEvent): void => {
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault()
          applyBold()
          break
        case 'i':
          e.preventDefault()
          applyItalic()
          break
        case 'u':
          e.preventDefault()
          applyUnderline()
          break
        case 's':
          e.preventDefault()
          applyStrikeThrough()
          break
        // 可扩展更多快捷键
      }
    }
    // Tab 键插入四个空格
    if (e.key === 'Tab') {
      e.preventDefault()
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && editorRef.value) {
        const range = sel.getRangeAt(0)
        // 插入文本节点（四个空格）
        const textNode = document.createTextNode('    ')
        range.insertNode(textNode)
        // 将光标移到插入文本之后
        range.setStartAfter(textNode)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        // 触发 input 事件，同步数据
        editorRef.value.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }

  // ---------- 获取当前选区 ----------
  const getCurrentRange = (): Range | null => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      return sel.getRangeAt(0)
    }
    return null
  }

  // ---------- 原生命令封装 ----------
  const applyBold = (): void => {
    saveSelection()
    execCommand('bold', false, null)
    restoreSelection()
  }

  const applyItalic = (): void => {
    saveSelection()
    execCommand('italic', false, null)
    restoreSelection()
  }

  const applyUnderline = (): void => {
    saveSelection()
    execCommand('underline', false, null)
    restoreSelection()
  }

  const applyStrikeThrough = (): void => {
    saveSelection()
    execCommand('strikeThrough', false, null)
    restoreSelection()
  }

  const applyColor = (color: string): void => {
    saveSelection()
    execCommand('foreColor', false, color)
    restoreSelection()
  }

  // 高亮：若未传颜色，使用默认黄色
  const applyHighlight = (color: string = '#FFEB3B'): void => {
    saveSelection()
    if (typeof customApplyHighlight === 'function') {
      customApplyHighlight(color)
    } else {
      execCommand('hiliteColor', false, color)
    }
    restoreSelection()
  }

  // 字号：先调用原生 fontSize(1~7)，再修正为精确像素
  const applyFontSize = (size: number): void => {
    saveSelection()
    if (typeof customApplyFontSize === 'function') {
      customApplyFontSize(size)
    } else {
      // fallback：使用 execCommand 的 fontSize（1~7）
      const fontSizeMap: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 }
      const level = Math.min(7, Math.max(1, Math.round(size / 10)))
      execCommand('fontSize', false, String(level))
      // 之后需修正为精确像素，此部分由 customApplyFontSize 处理
    }
    restoreSelection()
  }

  // 通用内联样式
  const applyInlineStyle = (style: Record<string, string>): void => {
    saveSelection()
    if (typeof customApplyInlineStyle === 'function') {
      customApplyInlineStyle(style)
    } else {
      console.warn('customApplyInlineStyle not implemented')
    }
    restoreSelection()
  }

  // 清除格式
  const applyClearFormat = (): void => {
    saveSelection()
    execCommand('removeFormat', false, null)
    restoreSelection()
  }

  // ---------- 插入内容 ----------
  const insertHtml = (html: string): void => {
    if (!editorRef.value) return
    saveSelection()
    execCommand('insertHTML', false, html)
    restoreSelection()
    handleInput(new Event('input'))
  }

  const insertText = (text: string): void => {
    if (!editorRef.value) return
    saveSelection()
    execCommand('insertText', false, text)
    restoreSelection()
    handleInput(new Event('input'))
  }

  // ---------- 获取/设置内容 ----------
  const getHtml = (): string => {
    return innerHtml.value
  }

  const setHtml = (html: string): void => {
    if (editorRef.value) {
      isUpdatingFromInternal = true
      innerHtml.value = html
      editorRef.value.innerHTML = html
      // 设置后将光标移到末尾
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.selectNodeContents(editorRef.value)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      emit('update:modelValue', html)
      nextTick(() => {
        isUpdatingFromInternal = false
      })
    }
  }

  // ---------- 焦点控制 ----------
  // 方法名与 EditorExposed 中的 focus / blur 一致
  const focus = (): void => {
    editorRef.value?.focus()
  }

  const blur = (): void => {
    editorRef.value?.blur()
  }

  // ---------- 选区变化监听 ----------
  let selectionChangeHandler: (() => void) | null = null

  const onSelectionChange = (): void => {
    const range = getCurrentRange()
    emit('selectionChange', range)
  }

  // 生命周期：挂载时添加 selectionchange 监听
  onMounted(() => {
    document.addEventListener('selectionchange', onSelectionChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    // 清理保存的 range
    savedRange.value = null
  })

  // ---------- 返回所有公共 API ----------
  // 注意：返回对象属性名必须与 UseIrEditorReturn 完全匹配
  return {
    editorRef,
    innerHtml,
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
    focus,    // 改为 focus，匹配接口
    blur,     // 改为 blur，匹配接口
    saveSelection,
    restoreSelection,
    handleInput,
    handleKeydown,
  }
}