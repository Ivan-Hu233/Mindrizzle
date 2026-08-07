// 与 ProseKit 编辑器 DOM / 内部 store 交互的纯工具函数（无组件状态）。
// 统一 try/catch：编辑器未挂载时访问 view 会抛错，这里统一返回 null 静默跳过。

import type { Editor } from '@prosekit/core'

/** 安全获取编辑器 view（未挂载时返回 null）。 */
export function getView(editor?: Editor | null): any {
  try {
    return editor?.view ?? null
  } catch {
    return null
  }
}

/** 取 pos 处块的 DOM 元素（用于读取 rect / 派发事件）。 */
export function getBlockEl(view: any, pos: number): HTMLElement | null {
  try {
    return view.nodeDOM(pos) as HTMLElement | null
  } catch {
    return null
  }
}

/** 取滚动容器（.editor-scroll）。 */
export function getScrollEl(view: any): HTMLElement | null {
  return view?.dom?.closest('.editor-scroll') ?? null
}

/** 是否移动端紧凑模式（RichTextEditor compact 类）。 */
export function isCompactView(view: any): boolean {
  return !!view?.dom?.closest('.editor-wrapper.compact')
}

/** 取本编辑器的 block-handle positioner 元素（用于解析内部 store）。 */
export function findPositionerEl(view: any): HTMLElement | null {
  return view?.dom?.closest('.editor-wrapper')?.querySelector('.block-handle-positioner') ?? null
}

/**
 * 解析 ProseKit 内部 BlockHandleStore（无公开 API）。
 * 通过 aria-ui context 的冒泡事件向上找 provider，provider 用 event.callback 返回 store。
 * 每个编辑器的 store 独立，故用闭包按实例缓存。
 */
export function createStoreResolver() {
  let cached: any = null
  return (el?: Element | null): any => {
    if (cached) return cached
    if (!el) return null
    const ev: any = new Event('aria-ui:context-request', { bubbles: true, composed: true })
    ev.key = 'aria-ui:context:prosekit-block-handle-store'
    ev.callback = (value: any) => {
      cached = value
    }
    el.dispatchEvent(ev)
    return cached
  }
}

/** 直接清掉 store 的 hoverState，让 popup 立即关闭（跳过 ProseKit 的节流 + 失效缓冲）。 */
export function clearStoreHover(view: any, getStore: (el?: Element | null) => any): void {
  getStore(findPositionerEl(view))?.hoverState?.set(undefined)
}
