import { debug, warn, error as logError } from "@tauri-apps/plugin-log"

// 默认字号映射（等级 -> 像素）
const DEFAULT_FONT_SIZE_MAP: Record<number, number> = {
  1: 10,
  2: 12,
  3: 14,
  4: 18,
  5: 24,
  6: 32,
  7: 48,
}

/**
 * 获取当前选区所在的容器元素，并提取当前字号（像素）
 */
function getCurrentFontSize(): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  let node: Node | null = range.startContainer
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode
  }
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement
    const computed = window.getComputedStyle(el)
    const fs = parseFloat(computed.fontSize)
    if (!isNaN(fs) && fs > 0) {
      return fs
    }
    node = node.parentNode
  }
  return null
}

/**
 * 获取包含选区的单个 <span>（如果选区完全在一个 <span> 内）
 */
function getContainingSpan(range: Range): HTMLSpanElement | null {
  let startNode: Node | null = range.startContainer
  while (startNode && startNode.nodeType !== Node.ELEMENT_NODE) {
    startNode = startNode.parentNode
  }
  if (!startNode || (startNode as HTMLElement).tagName !== 'SPAN') return null
  const span = startNode as HTMLSpanElement

  let endNode: Node | null = range.endContainer
  while (endNode && endNode.nodeType !== Node.ELEMENT_NODE) {
    endNode = endNode.parentNode
  }
  if (!endNode) return null
  if (endNode === span || (endNode as HTMLElement).closest?.('span') === span) {
    const common = range.commonAncestorContainer
    if (common === span || (common.nodeType === Node.ELEMENT_NODE && (common as HTMLElement).closest?.('span') === span)) {
      return span
    }
  }
  return null
}

/**
 * 应用样式到选区：如果选区位于单个 <span> 内，则合并样式；否则用新 <span> 包裹。
 * 导出此函数以便外部直接调用（如 customCommands）
 */
export function applyStyleToSelection(style: Record<string, string>): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    warn('[execCommands] 无选区')
    return
  }
  const range = sel.getRangeAt(0)
  if (range.collapsed) {
    debug('[execCommands] 选区折叠，忽略')
    return
  }

  const existingSpan = getContainingSpan(range)
  if (existingSpan) {
    Object.entries(style).forEach(([key, value]) => {
      existingSpan.style.setProperty(key, value)
    })
    sel.removeAllRanges()
    sel.addRange(range)
    return
  }

  try {
    const contents = range.extractContents()
    const span = document.createElement('span')
    Object.entries(style).forEach(([key, value]) => {
      span.style.setProperty(key, value)
    })
    span.appendChild(contents)
    range.insertNode(span)
    sel.removeAllRanges()
    const newRange = document.createRange()
    newRange.selectNodeContents(span)
    sel.addRange(newRange)
  } catch (error) {
    logError(`[execCommands] 应用样式失败: ${error}`)
  }
}

/**
 * 清除选中内容的格式（移除所有内联样式和格式标签）
 */
function removeFormat(): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (range.collapsed) return

  const contents = range.extractContents()
  function clean(node: Node): Node {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      el.removeAttribute('style')
      const formatTags = ['SPAN', 'B', 'I', 'U', 'S', 'STRIKE', 'FONT', 'EM', 'STRONG']
      if (formatTags.includes(el.tagName)) {
        const fragment = document.createDocumentFragment()
        while (el.firstChild) {
          fragment.appendChild(clean(el.firstChild))
        }
        return fragment
      }
      const children = Array.from(el.childNodes)
      children.forEach(child => {
        const cleaned = clean(child)
        if (cleaned !== child) {
          el.replaceChild(cleaned, child)
        }
      })
      return el
    } else {
      return node.cloneNode(true)
    }
  }
  const cleaned = clean(contents)
  range.insertNode(cleaned)
  sel.removeAllRanges()
  const newRange = document.createRange()
  newRange.selectNodeContents(cleaned)
  sel.addRange(newRange)
}

/**
 * 在光标处插入 HTML
 */
function insertHTML(html: string): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const temp = document.createElement('div')
  temp.innerHTML = html
  const fragment = document.createDocumentFragment()
  while (temp.firstChild) {
    fragment.appendChild(temp.firstChild)
  }
  range.insertNode(fragment)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * 在光标处插入纯文本
 */
function insertText(text: string): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * 执行命令（替代 document.execCommand）
 * @param commandId 命令标识符
 * @param _showUI 忽略（保留兼容）
 * @param value 命令参数
 * @returns 是否执行成功
 */
export function execCommand(
  commandId: string,
  _showUI: boolean = false,
  value: string | null = null
): boolean {
  try {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      debug(`[execCommands] 无选区，命令 ${commandId} 忽略`)
      return false
    }

    switch (commandId) {
      case 'bold':
        applyStyleToSelection({ 'font-weight': 'bold' })
        return true

      case 'italic':
        applyStyleToSelection({ 'font-style': 'italic' })
        return true

      case 'underline':
        applyStyleToSelection({ 'text-decoration': 'underline' })
        return true

      case 'strikeThrough':
        applyStyleToSelection({ 'text-decoration': 'line-through' })
        return true

      case 'foreColor':
        if (!value) return false
        applyStyleToSelection({ color: value })
        return true

      case 'hiliteColor':
        if (!value) return false
        applyStyleToSelection({ 'background-color': value })
        return true

      case 'fontSize': {
        if (!value) return false
        let pixelSize: number | null = null
        const parsed = parseInt(value, 10)
        if (!isNaN(parsed)) {
          pixelSize = parsed
        } else {
          const level = parseInt(value, 10)
          if (!isNaN(level) && level >= 1 && level <= 7) {
            const currentSize = getCurrentFontSize()
            if (currentSize) {
              const baseSize = DEFAULT_FONT_SIZE_MAP[3] // 14
              const targetSize = DEFAULT_FONT_SIZE_MAP[level] || 14
              const ratio = targetSize / baseSize
              pixelSize = currentSize * ratio
            } else {
              pixelSize = DEFAULT_FONT_SIZE_MAP[level] || 14
            }
          } else {
            return false
          }
        }
        if (pixelSize === null || pixelSize <= 0) return false
        applyStyleToSelection({ 'font-size': `${pixelSize}px` })
        return true
      }

      case 'removeFormat':
        removeFormat()
        return true

      case 'insertHTML':
        if (!value) return false
        insertHTML(value)
        return true

      case 'insertText':
        if (!value) return false
        insertText(value)
        return true

      default:
        warn(`[execCommands] 未知命令: ${commandId}`)
        return false
    }
  } catch (error) {
    logError(`[execCommands] 执行 ${commandId} 失败: ${error}`)
    return false
  }
}