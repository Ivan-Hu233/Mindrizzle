/**
 * 执行 document.execCommand，并处理异常
 * @param commandId 命令标识符（如 'bold', 'italic', 'insertHTML' 等）
 * @param showUI 是否显示用户界面（通常为 false）
 * @param value 命令参数（如颜色值、字号等）
 * @returns 是否执行成功
 */
export function execCommand(
  commandId: string,
  showUI: boolean = false,
  value: string | null = null
): boolean {
  try {
    // 检查 document 是否可用
    if (typeof document === 'undefined' || !document.execCommand) {
      console.warn('[IrEditor] document.execCommand 不可用')
      return false
    }
    // 检查是否有活动选区，如果没有，可能执行失败，但 execCommand 通常会在无选区时忽略
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      // 没有选区，可能无法执行命令，但可以尝试执行（有些命令如 insertText 会创建选区）
      console.debug('[IrEditor] 执行 execCommand 时无选区，命令可能无效')
    }
    const result = document.execCommand(commandId, showUI, value ?? undefined)
    if (!result) {
      console.warn(`[IrEditor] execCommand "${commandId}" 执行失败`)
    } else {
      console.debug(`[IrEditor] execCommand "${commandId}" 执行成功`)
    }
    return result
  } catch (error) {
    console.error(`[IrEditor] execCommand "${commandId}" 抛出异常:`, error)
    return false
  }
}