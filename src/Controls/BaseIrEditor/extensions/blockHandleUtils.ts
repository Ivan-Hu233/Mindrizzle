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

/** 取 popup 会被裁剪的可见区顶部（画布容器 .canvas-container 的上缘；无则退化为视口顶部 0）。 */
export function getClipTop(view: any): number {
  const container = view?.dom?.closest('.canvas-container') as HTMLElement | null
  return container ? container.getBoundingClientRect().top : 0
}

/** 取 popup 会被裁剪的可见区底部（画布容器 .canvas-container 的下缘；无则退化为视口底部）。 */
export function getClipBottom(view: any): number {
  const container = view?.dom?.closest('.canvas-container') as HTMLElement | null
  return container ? container.getBoundingClientRect().bottom : window.innerHeight
}

/** 取 block-handle popup 的实际渲染高度（紧凑模式约 35px）。关闭时 popup 是 display:none
 *  无法量高：临时显示为 inline-flex 同步测量后立即还原（同一帧内不闪屏）。 */
export function getPopupHeight(view: any): number {
  const popup = view?.dom?.closest('.editor-wrapper')?.querySelector('.block-handle-popup') as HTMLElement | null
  if (!popup) return 35
  const prevDisplay = popup.style.display
  const prevVisibility = popup.style.visibility
  if (prevDisplay !== 'inline-flex') {
    popup.style.display = 'inline-flex'
    popup.style.visibility = 'hidden'
  }
  const h = popup.getBoundingClientRect().height
  popup.style.display = prevDisplay
  popup.style.visibility = prevVisibility
  return h > 0 ? h : 35
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
