// 因编辑器未挂载时访问 view 会抛错，故统一 try/catch 返回 null 静默跳过

import type { Editor } from '@prosekit/core'

export function getView(editor?: Editor | null): any {
  try {
    return editor?.view ?? null
  } catch {
    return null
  }
}

export function getBlockEl(view: any, pos: number): HTMLElement | null {
  try {
    return view.nodeDOM(pos) as HTMLElement | null
  } catch {
    return null
  }
}

export function getScrollEl(view: any): HTMLElement | null {
  return view?.dom?.closest('.editor-scroll') ?? null
}

export function getClipTop(view: any): number {
  const container = view?.dom?.closest('.canvas-container') as HTMLElement | null
  return container ? container.getBoundingClientRect().top : 0
}

export function getClipBottom(view: any): number {
  const container = view?.dom?.closest('.canvas-container') as HTMLElement | null
  return container ? container.getBoundingClientRect().bottom : window.innerHeight
}

// 因关闭时 popup 为 display:none 无法量高，故临时显示为 inline-flex 同步测量后立即还原（同一帧内不闪屏）
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

// 因关闭时 popup 为 display:none 无法量宽，故临时显示为 inline-flex 同步测量后立即还原（同一帧内不闪屏）
export function getPopupWidth(view: any): number {
  const popup = view?.dom?.closest('.editor-wrapper')?.querySelector('.block-handle-popup') as HTMLElement | null
  if (!popup) return 64
  const prevDisplay = popup.style.display
  const prevVisibility = popup.style.visibility
  if (prevDisplay !== 'inline-flex') {
    popup.style.display = 'inline-flex'
    popup.style.visibility = 'hidden'
  }
  const w = popup.getBoundingClientRect().width
  popup.style.display = prevDisplay
  popup.style.visibility = prevVisibility
  return w > 0 ? w : 64
}

export function isCompactView(view: any): boolean {
  return !!view?.dom?.closest('.editor-wrapper.compact')
}

export function findPositionerEl(view: any): HTMLElement | null {
  return view?.dom?.closest('.editor-wrapper')?.querySelector('.block-handle-positioner') ?? null
}

// 因 ProseKit 未公开 BlockHandleStore API，故经 aria-ui context 冒泡事件取 provider 回调返回 store；
// 且每个编辑器 store 独立，故用闭包按实例缓存
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

// 因需跳过 ProseKit 的节流与失效缓冲立即关闭 popup，故直接清 store 的 hoverState
export function clearStoreHover(view: any, getStore: (el?: Element | null) => any): void {
  getStore(findPositionerEl(view))?.hoverState?.set(undefined)
}
