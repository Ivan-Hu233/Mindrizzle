// useIrEditor.ts
import {
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  type Ref,
  getCurrentInstance,
  createApp,
  type Component,
  type App,
} from 'vue'
import type { UseIrEditorProps, UseIrEditorReturn } from '../types/editor'

// 导入 Vuetify 实例（请根据您的项目实际路径调整）
import vuetify from '../../../Vuetify'

// 导入命令工具（与之前相同）
import { execCommand } from '../commands/execCommands'
import {
  customApplyFontSize,
  customApplyInlineStyle,
  customApplyHighlight,
} from '../commands/customCommands'
import { warn, error as logError } from '@tauri-apps/plugin-log'

export function useIrEditor(
  props: UseIrEditorProps,
  emit: (event: any, ...args: any[]) => void
): UseIrEditorReturn {
  // ---------- 状态 ----------
  const editorRef = ref<HTMLElement | null>(null)
  const innerHtml = ref<string>(props.modelValue || '')
  const savedRange = ref<Range | null>(null)
  const isEmpty = ref(true)

  // 内部标志，防止循环更新
  let isUpdatingFromInternal = false
  // 是否正在批量重建
  let isMounting = false

  // ---------- 选区管理 ----------
  const saveSelection = (): void => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      savedRange.value = range.cloneRange()
    } else {
      savedRange.value = null
    }
  }

  const restoreSelection = (): void => {
    if (!editorRef.value) return
    const range = savedRange.value
    if (range) {
      try {
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        return
      } catch (_) {
        // fallback
      }
    }
    const el = editorRef.value
    const sel = window.getSelection()
    if (sel) {
      const newRange = document.createRange()
      newRange.selectNodeContents(el)
      newRange.collapse(false)
      sel.removeAllRanges()
      sel.addRange(newRange)
    }
  }

  // ---------- 内容同步 ----------
  watch(
    () => props.modelValue,
    (newVal) => {
      if (isUpdatingFromInternal) return
      const val = newVal || ''
      if (innerHtml.value !== val) {
        innerHtml.value = val
        if (editorRef.value) {
          saveSelection()
          editorRef.value.innerHTML = val
          nextTick(() => {
            restoreSelection()
            // 重新挂载所有组件（因为 innerHTML 被完全替换）
            mountAllComponents()
          })
        }
      }
    },
    { immediate: true }
  )

  watch(
    editorRef,
    (el) => {
      if (el) {
        el.innerHTML = innerHtml.value
        const sel = window.getSelection()
        if (sel) {
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
        }
        nextTick(() => {
          mountAllComponents()
          checkIsEmpty()
        })
      }
    },
    { immediate: true }
  )

  // ---------- 空状态检查 ----------
  const checkIsEmpty = () => {
    if (!editorRef.value) return
    const text = editorRef.value.innerText?.trim() || ''
    const hasComponent = editorRef.value.querySelector('[data-vue-id]') !== null
    isEmpty.value = text.length === 0 && !hasComponent
  }

  // ---------- 输入事件 ----------
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
    nextTick(() => {
      mountAllComponents()
      checkIsEmpty()
    })
  }

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
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && editorRef.value) {
        const range = sel.getRangeAt(0)
        const textNode = document.createTextNode('    ')
        range.insertNode(textNode)
        range.setStartAfter(textNode)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        editorRef.value.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }

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
    execCommand('bold')
    restoreSelection()
  }
  const applyItalic = (): void => {
    saveSelection()
    execCommand('italic')
    restoreSelection()
  }
  const applyUnderline = (): void => {
    saveSelection()
    execCommand('underline')
    restoreSelection()
  }
  const applyStrikeThrough = (): void => {
    saveSelection()
    execCommand('strikeThrough')
    restoreSelection()
  }
  const applyColor = (color: string): void => {
    saveSelection()
    execCommand('foreColor', false, color)
    restoreSelection()
  }
  const applyHighlight = (color: string = '#FFEB3B'): void => {
    saveSelection()
    customApplyHighlight(color)
    restoreSelection()
  }
  const applyFontSize = (size: number): void => {
    saveSelection()
    customApplyFontSize(size)
    restoreSelection()
  }
  const applyInlineStyle = (style: Record<string, string>): void => {
    saveSelection()
    customApplyInlineStyle(style)
    restoreSelection()
  }
  const applyClearFormat = (): void => {
    saveSelection()
    execCommand('removeFormat')
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
  const getHtml = (): string => innerHtml.value

  const setHtml = (html: string): void => {
    // 先销毁所有组件
    for (const [uuid] of componentInstances) {
      destroyComponent(uuid)
    }
    if (editorRef.value) {
      isUpdatingFromInternal = true
      innerHtml.value = html
      editorRef.value.innerHTML = html
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
        mountAllComponents()
        checkIsEmpty()
      })
    }
  }

  // ---------- 焦点 ----------
  const focus = (): void => editorRef.value?.focus()
  const blur = (): void => editorRef.value?.blur()

  // ---------- 组件系统 ----------
  const componentRegistry = new Map<string, Component>()
  // 存储格式：uuid -> { app, props, el? }
  const componentInstances = new Map<
    string,
    { app: App; props: Record<string, any> }
  >()

  // 初始化注册外部组件
  if (props.components) {
    for (const [name, comp] of Object.entries(props.components)) {
      componentRegistry.set(name, comp)
    }
  }

  const generateComponentName = (comp: Component): string => {
    const name = (comp as any).name || (comp as any).__name || 'AnonymousComponent'
    let finalName = name
    let counter = 1
    while (componentRegistry.has(finalName)) {
      finalName = `${name}_${counter++}`
    }
    return finalName
  }

  const registerComponent = (name: string, component: Component) => {
    componentRegistry.set(name, component)
  }

  // ---------- 挂载单个组件 ----------
  const mountComponent = (uuid: string) => {
    if (!editorRef.value) return
    const el = editorRef.value.querySelector(
      `[data-vue-id="${uuid}"]`
    ) as HTMLElement
    if (!el) {
      // 占位不存在，销毁已有实例
      destroyComponent(uuid)
      return
    }

    // 如果已经存在实例，则更新 props（重新挂载）
    if (componentInstances.has(uuid)) {
      // 简单处理：先销毁再重建
      destroyComponent(uuid)
      // 继续执行挂载
    }

    const compName = el.getAttribute('data-vue-name') || ''
    const comp = componentRegistry.get(compName)
    if (!comp) {
      warn(`Component "${compName}" not found for uuid ${uuid}`)
      return
    }

    // 解析 props
    let propsData = {}
    const propsStr = el.getAttribute('data-vue-props') || '{}'
    try {
      propsData = JSON.parse(propsStr)
    } catch (_) {
      propsData = {}
    }

    // 注入编辑器上下文（只读）
    const context = { insertText, insertHtml, getHtml }
    // 合并 props，并添加事件处理
    const finalProps = {
      ...propsData,
      editorContext: context,
      // 如果组件需要 v-model，我们通过 onUpdate:modelValue 事件接收更新
      'onUpdate:modelValue': (val: any) => {
        // 当组件内部更新 modelValue 时，我们需要同步到编辑器内容
        // 但此时我们不能用 setHtml 或整体替换，因为会丢失其他内容
        // 这里我们更新占位元素的 data-vue-props，然后重新挂载该组件（并刷新整个编辑器内容？）
        // 更好的方案：在编辑器 HTML 中，每个组件占位符本身即代表其内容，
        // 我们只需更新该占位符的 data-vue-props，然后触发整体内容更新。
        // 但为了简单且不影响其他内容，我们采用以下方式：
        // 1. 更新占位符的 data-vue-props 属性
        const currentEl = editorRef.value?.querySelector(
          `[data-vue-id="${uuid}"]`
        )
        if (currentEl) {
          try {
            const newProps = { ...propsData, modelValue: val }
            currentEl.setAttribute('data-vue-props', JSON.stringify(newProps))
          } catch (_) {}
          // 2. 触发输入事件，让编辑器同步内容（但这样会重新序列化整个 innerHTML）
          // 但我们不希望重新序列化，因为组件内部内容已改变，但编辑器 DOM 中占位符依然保留。
          // 我们可以手动触发 input 事件，以同步 innerHtml。
          if (editorRef.value) {
            editorRef.value.dispatchEvent(new Event('input', { bubbles: true }))
          }
          // 注意：这会导致 handleInput 读取 innerHTML，其中包含更新后的占位属性，从而同步 modelValue。
          // 但同时会触发 mountAllComponents，可能会重新挂载该组件，但我们已在 mountComponent 内处理。
          // 但为了避免无限循环，我们设置标志。
        }
      },
    }

    // 创建独立应用，安装 Vuetify
    const app = createApp(comp, finalProps)
    app.use(vuetify)

    // 挂载到占位元素
    app.mount(el)

    // 存储实例
    componentInstances.set(uuid, { app, props: finalProps })
  }

  // ---------- 销毁组件 ----------
  const destroyComponent = (uuid: string) => {
    const entry = componentInstances.get(uuid)
    if (entry) {
      const { app } = entry
      try {
        app.unmount()
      } catch (_) {
        // 忽略卸载错误
      }
      componentInstances.delete(uuid)
    }
    // 同时清理占位元素？占位元素保留在 DOM 中，供下次重建使用
  }

  // ---------- 扫描并挂载所有组件 ----------
  const mountAllComponents = () => {
    if (!editorRef.value || isMounting) return
    isMounting = true

    // 收集当前所有占位符 UUID
    const currentUuids = new Set<string>()
    const elements = editorRef.value.querySelectorAll('[data-vue-id]')
    elements.forEach((el) => {
      const uuid = el.getAttribute('data-vue-id')
      if (uuid) currentUuids.add(uuid)
    })

    // 移除已不存在的实例
    for (const [uuid] of componentInstances) {
      if (!currentUuids.has(uuid)) {
        destroyComponent(uuid)
      }
    }

    // 挂载新增的或未挂载的
    elements.forEach((el) => {
      const uuid = el.getAttribute('data-vue-id')
      if (uuid && !componentInstances.has(uuid)) {
        mountComponent(uuid)
      }
    })

    isMounting = false
  }

  // ---------- 插入 Vue 组件 ----------
  const insertVueComponent = (
    component: Component | string,
    propsData: Record<string, any> = {}
  ): string => {
    if (!editorRef.value) {
      warn('Editor not mounted')
      return ''
    }

    let comp: Component | undefined
    let compName: string = ''
    if (typeof component === 'string') {
      compName = component
      comp = componentRegistry.get(compName)
      if (!comp) {
        logError(`Component "${compName}" not registered`)
        return ''
      }
    } else {
      comp = component
      // 查找是否已注册
      for (const [name, c] of componentRegistry) {
        if (c === component) {
          compName = name
          break
        }
      }
      if (!compName) {
        compName = generateComponentName(component)
        componentRegistry.set(compName, component)
      }
    }

    const uuid = crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2, 8)

    // 序列化 props
    let propsJson = '{}'
    try {
      propsJson = JSON.stringify(propsData)
    } catch (_) {}

    // 占位元素：去掉 all:initial，保留继承样式；设置 display:block 宽度100%
    const placeholderHtml = `<div 
      data-vue-id="${uuid}" 
      data-vue-name="${compName}" 
      data-vue-props='${propsJson}' 
      contenteditable="false" 
      style="
        display: block;
        width: 100%;
        min-width: 80px;
        min-height: 40px;
        border: 1px dashed #aaa;
        padding: 4px;
        border-radius: 4px;
        box-sizing: border-box;
      "></div>`

    saveSelection()
    execCommand('insertHTML', false, placeholderHtml)
    if (editorRef.value) {
      editorRef.value.dispatchEvent(new Event('input', { bubbles: true }))
    }
    restoreSelection()

    nextTick(() => {
      mountComponent(uuid)
    })

    return uuid
  }

  // ---------- 更新组件 props ----------
  const updateComponentProps = (uuid: string, newProps: Record<string, any>) => {
    const el = editorRef.value?.querySelector(`[data-vue-id="${uuid}"]`)
    if (!el) {
      warn(`Component ${uuid} not found in DOM`)
      return
    }
    // 更新占位属性
    let existingProps = {}
    const propsStr = el.getAttribute('data-vue-props') || '{}'
    try {
      existingProps = JSON.parse(propsStr)
    } catch (_) {}
    const merged = { ...existingProps, ...newProps }
    try {
      el.setAttribute('data-vue-props', JSON.stringify(merged))
    } catch (_) {}
    // 重新挂载组件（销毁并重建）
    destroyComponent(uuid)
    mountComponent(uuid)
  }

  // ---------- 移除组件 ----------
  const removeComponent = (uuid: string) => {
    const el = editorRef.value?.querySelector(`[data-vue-id="${uuid}"]`)
    if (el) {
      el.remove()
    }
    destroyComponent(uuid)
    if (editorRef.value) {
      editorRef.value.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  // ---------- 选区变化监听 ----------
  const onSelectionChange = (): void => {
    const range = getCurrentRange()
    emit('selectionChange', range)
  }

  onMounted(() => {
    document.addEventListener('selectionchange', onSelectionChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    // 清理所有组件
    for (const [uuid] of componentInstances) {
      destroyComponent(uuid)
    }
    componentInstances.clear()
    componentRegistry.clear()
    savedRange.value = null
  })

  // ---------- 返回 API ----------
  return {
    editorRef,
    innerHtml,
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
    handleInput,
    handleKeydown,
    insertVueComponent,
    registerComponent,
    updateComponentProps,
    removeComponent,
    mountAllComponents,
  }
}