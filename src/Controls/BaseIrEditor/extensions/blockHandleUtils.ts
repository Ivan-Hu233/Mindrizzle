// 编辑器未挂载时访问 view 会抛错，统一 try/catch 返回 null 静默跳过

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
    // nodeDOM 可能返回文本节点（无 getBoundingClientRect），仅接受元素节点
    const el = view.nodeDOM(pos)
    return el instanceof HTMLElement ? el : null
  } catch {
    return null
  }
}

// 因 Vue 节点视图外层是 display:contents、getBoundingClientRect 恒为 0×0 且位于 (0,0)，
// 故块矩形需下探到有尺寸的后代，否则按零矩形派发的伪 pointermove 会落到 (0,0) 被判为无块命中
export function getVisibleBlockRect(el: HTMLElement | null): DOMRect | null {
  if (!el?.isConnected) return null
  const rect = el.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect
  for (const child of Array.from(el.children)) {
    const childRect = getVisibleBlockRect(child as HTMLElement)
    if (childRect) return childRect
  }
  return null
}

export function getBlockRect(view: any, pos: number): DOMRect | null {
  return getVisibleBlockRect(getBlockEl(view, pos))
}

// 向块 DOM 派发伪 pointermove 让扩展重新确认 hover；坐标必须取自真实尺寸的块矩形，
// 否则零矩形会算出 (0,0) 被扩展判为无块命中而反向清掉 hover
// （扩展内部只有 pointermove 有节流，伪事件需周期性重派，见 useHoverUi 的 keepAlive）
export function dispatchBlockHover(view: any, pos: number): void {
  const dom = getBlockEl(view, pos)
  const rect = getVisibleBlockRect(dom)
  if (!dom || !rect) return
  dom.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX: rect.x + 2,
      clientY: rect.y + rect.height / 2,
      pointerId: 1,
    }),
  )
}

// 因多处需按"最近一次真实指针位置"复核（hover 误报、点击选中后重派 hover），
// 故在模块级记录一次，忽略自身派发的伪 pointer 事件
const realPointer = { x: Number.NaN, y: Number.NaN }
let pointerTracked = false

export function getRealPointer(): { x: number; y: number } {
  if (!pointerTracked) {
    pointerTracked = true
    window.addEventListener(
      'pointermove',
      (event) => {
        if (!event.isTrusted) return
        realPointer.x = event.clientX
        realPointer.y = event.clientY
      },
      { passive: true },
    )
  }
  return realPointer
}

export function isPointerInsideRect(rect: DOMRect | null): boolean {
  const { x, y } = getRealPointer()
  if (!rect || Number.isNaN(x)) return false
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
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

// 关闭时 popup 为 display:none 无法量高，临时显示为 inline-flex 同步测量后立即还原（同一帧内不闪屏）
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

// 关闭时 popup 为 display:none 无法量宽，临时显示为 inline-flex 同步测量后立即还原（同一帧内不闪屏）
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

// ProseKit 未公开 BlockHandleStore API，经 aria-ui context 冒泡事件取 provider 回调返回 store；
// 每个编辑器 store 独立，用闭包按实例缓存
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

// 跳过 ProseKit 的节流与失效缓冲立即关闭 popup，直接清 store 的 hoverState
export function clearStoreHover(view: any, getStore: (el?: Element | null) => any): void {
  getStore(findPositionerEl(view))?.hoverState?.set(undefined)
}
