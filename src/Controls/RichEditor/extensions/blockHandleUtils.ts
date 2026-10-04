// 编辑器未挂载时访问 view 会抛错，所以统一 try/catch 返回 null

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
    // nodeDOM 可能返回文本节点，所以仅接受元素节点
    const el = view.nodeDOM(pos)
    return el instanceof HTMLElement ? el : null
  } catch {
    return null
  }
}

// Vue 节点视图外层 display:contents、BCR 恒为 0×0，所以块矩形需下探到有尺寸的后代
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

export function getCanvasViewportRect(view: any): DOMRect {
  const container = view?.dom?.closest('.canvas-container') as HTMLElement | null
  return container?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

export function getClipRect(view: any): DOMRect {
  const containerRect = getCanvasViewportRect(view)
  const scroll = getScrollEl(view)
  if (!scroll) return containerRect
  const scrollRect = scroll.getBoundingClientRect()
  const left = Math.max(containerRect.left, scrollRect.left)
  const top = Math.max(containerRect.top, scrollRect.top)
  const right = Math.min(containerRect.right, scrollRect.right)
  const bottom = Math.min(containerRect.bottom, scrollRect.bottom)
  return new DOMRect(left, top, Math.max(right - left, 0), Math.max(bottom - top, 0))
}

export function getClipTop(view: any): number {
  return getClipRect(view).top
}

export function getClipBottom(view: any): number {
  return getClipRect(view).bottom
}

export function getVisibleBlockRectInViewport(view: any, el: HTMLElement | null): DOMRect | null {
  const rect = getVisibleBlockRect(el)
  if (!rect) return null
  const clip = getClipRect(view)
  const left = Math.max(layoutToViewportX(view, rect.left), clip.left)
  const top = Math.max(layoutToViewportY(view, rect.top), clip.top)
  const right = Math.min(layoutToViewportX(view, rect.right), clip.right)
  const bottom = Math.min(layoutToViewportY(view, rect.bottom), clip.bottom)
  if (right <= left || bottom <= top) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

// 向块 DOM 派发伪 pointermove 让扩展重认 hover；坐标须取自真实尺寸矩形（零矩形会落到 (0,0) 反向清 hover）
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

// 多处需按最近真实指针位置复核，所以模块级记录一次，忽略自身伪事件
const realPointer = { x: Number.NaN, y: Number.NaN }
let pointerTracked = false

export function getRealPointer(): { x: number; y: number } {
  if (!pointerTracked) {
    pointerTracked = true
    // hover 自解析会 stopPropagation，所以用捕获阶段
    window.addEventListener(
      'pointermove',
      (event) => {
        if (!event.isTrusted) return
        realPointer.x = event.clientX
        realPointer.y = event.clientY
      },
      { passive: true, capture: true },
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

// 判据：块完全显示在视口内时贴边拖拽只滚块内内容（画布平移会与内容滚动互相拉扯）；两坐标空间需先换算
export function isFullyVisibleInCanvas(el: HTMLElement | null): boolean {
  const container = el?.closest('.canvas-container') as HTMLElement | null
  const wrapper = el?.closest('.drag-wrapper') as HTMLElement | null
  if (!container || !wrapper) return false
  const cr = container.getBoundingClientRect()
  const wr = wrapper.getBoundingClientRect()
  const left = layoutToViewportX(wrapper, wr.left)
  const right = layoutToViewportX(wrapper, wr.left + wr.width)
  const top = layoutToViewportY(wrapper, wr.top)
  const bottom = layoutToViewportY(wrapper, wr.top + wr.height)
  const pad = 1
  return left >= cr.left + pad && right <= cr.right - pad && top >= cr.top + pad && bottom <= cr.bottom - pad
}

// 画布 CSS zoom 下：视觉 = 布局 × k，k = zoom / domScale（domScale = canvas/容器宽比 × zoom，兼容 BCR 已含 zoom 的浏览器）。
// 入参可为 view 或元素本身，若只认 view 会让传元素的调用静默拿到 1、zoom≠1 时换算恒错
interface CanvasScaleEntry {
  epoch: number
  value: number
}

// 逐帧路径反复调用且 getComputedStyle 会触发强制样式重算，所以按 .canvas 元素缓存系数
const canvasScaleCache = new WeakMap<HTMLElement, CanvasScaleEntry>()
let canvasScaleEpoch = 0

// pan/zoom 或容器尺寸变化会改变系数，所以变换落定后须失效缓存
export function invalidateCanvasScaleCache(): void {
  canvasScaleEpoch += 1
}

function getCanvasScale(view: any): number {
  const dom = (view?.dom ?? view) as HTMLElement | null
  const canvasEl = dom?.closest?.('.canvas') as HTMLElement | null
  const container = dom?.closest?.('.canvas-container') as HTMLElement | null
  if (!canvasEl || !container) return 1
  const cached = canvasScaleCache.get(canvasEl)
  if (cached && cached.epoch === canvasScaleEpoch) return cached.value
  const zoom = Number.parseFloat(getComputedStyle(canvasEl).zoom) || 1
  const cr = container.getBoundingClientRect()
  const wr = canvasEl.getBoundingClientRect()
  const domScale = cr.width > 0 ? (wr.width / cr.width) * zoom : 1
  const value = domScale > 0 ? zoom / domScale : 1
  canvasScaleCache.set(canvasEl, { epoch: canvasScaleEpoch, value })
  return value
}

// 编辑器内部布局坐标/长度 → 视口视觉坐标/长度（x、y 同系数）
export function layoutToViewportX(view: any, layoutX: number): number {
  return layoutX * getCanvasScale(view)
}

export function layoutToViewportY(view: any, layoutY: number): number {
  return layoutY * getCanvasScale(view)
}

export function layoutToViewportSize(view: any, size: number): number {
  return size * getCanvasScale(view)
}

// 视口视觉坐标/长度 → 布局坐标/长度（如 popup 偏移量，须与 rect 同空间才生效）
export function viewportToLayout(view: any, value: number): number {
  const k = getCanvasScale(view)
  return k > 0 ? value / k : value
}

function popupElOf(view: any): HTMLElement | null {
  return (findPositionerEl(view)?.querySelector('.block-handle-popup') as HTMLElement | null) ?? null
}

// 关闭时 popup 为 display:none 无法量高，所以临时显示同步测量后还原
export function getPopupHeight(view: any): number {
  const popup = popupElOf(view)
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

// 关闭时 popup 为 display:none 无法量宽，所以临时显示同步测量后还原
export function getPopupWidth(view: any): number {
  const popup = popupElOf(view)
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

// positioner 被 Teleport 到 .canvas（不在 .editor-wrapper 内），所以按 data-owner 在 .canvas 里找回对应实例
export function findPositionerEl(view: any): HTMLElement | null {
  const wrapper = view?.dom?.closest?.('.editor-wrapper') as HTMLElement | null
  const inWrapper = wrapper?.querySelector('.block-handle-positioner') as HTMLElement | null
  if (inWrapper) return inWrapper
  const id = (view?.dom?.closest?.('.drag-wrapper') as HTMLElement | null)?.dataset.id
  if (!id) return null
  return document.querySelector<HTMLElement>(`.block-handle-positioner[data-owner="${id}"]`)
}

// ProseKit 未公开 BlockHandleStore API，所以经 aria-ui context 冒泡事件取 provider 回调；每实例缓存
function createContextResolver(key: string) {
  let cached: any = null
  return (el?: Element | null): any => {
    if (cached) return cached
    if (!el) return null
    const ev: any = new Event('aria-ui:context-request', { bubbles: true, composed: true })
    ev.key = key
    ev.callback = (value: any) => {
      cached = value
    }
    el.dispatchEvent(ev)
    return cached
  }
}

export function createStoreResolver() {
  return createContextResolver('aria-ui:context:prosekit-block-handle-store')
}

// overlay store 持有 anchorElement，换成指向当前行的动态参考后由 autoUpdate 自行重算位置
export function createOverlayStoreResolver() {
  return createContextResolver('aria-ui:context:prosekit-block-handle-overlay-store')
}

// 跳过 ProseKit 节流与失效缓冲立即关闭 popup
export function clearStoreHover(view: any, getStore: (el?: Element | null) => any): void {
  getStore(findPositionerEl(view))?.hoverState?.set(undefined)
}