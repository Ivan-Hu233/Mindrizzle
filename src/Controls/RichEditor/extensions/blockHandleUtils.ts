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
    // 捕获阶段：hover 自解析在 zoom≠1 时会 stopPropagation 阻断后续节点，冒泡阶段将收不到
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

export function getClipTop(view: any): number {
  const container = view?.dom?.closest('.canvas-container') as HTMLElement | null
  return container ? container.getBoundingClientRect().top : 0
}

// 画布用 CSS zoom 缩放：编辑器内元素的 getBoundingClientRect 是 .canvas 的布局坐标
// （Chrome 下不含 zoom，且与原点是文档原点），鼠标/视口是视觉坐标，换算系数 k = zoom / domScale，
// domScale 用"canvas 与容器的宽度比 × zoom"实测（兼容 BCR 已含 zoom 的浏览器，此时 k 退化为 1）。
// 实测 zoom=0.5 时布局 y=797 的行渲染在视口 y≈398，即视觉 = 布局 × k，与容器偏移无关
function getCanvasScale(view: any): number {
  const canvasEl = view?.dom?.closest?.('.canvas') as HTMLElement | null
  const container = view?.dom?.closest?.('.canvas-container') as HTMLElement | null
  if (!canvasEl || !container) return 1
  const zoom = Number.parseFloat(getComputedStyle(canvasEl).zoom) || 1
  const cr = container.getBoundingClientRect()
  const wr = canvasEl.getBoundingClientRect()
  const domScale = cr.width > 0 ? (wr.width / cr.width) * zoom : 1
  return domScale > 0 ? zoom / domScale : 1
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

export function getClipBottom(view: any): number {
  const container = view?.dom?.closest('.canvas-container') as HTMLElement | null
  return container ? container.getBoundingClientRect().bottom : window.innerHeight
}

function popupElOf(view: any): HTMLElement | null {
  return (findPositionerEl(view)?.querySelector('.block-handle-popup') as HTMLElement | null) ?? null
}

// 关闭时 popup 为 display:none 无法量高，临时显示为 inline-flex 同步测量后立即还原（同一帧内不闪屏）
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

// 关闭时 popup 为 display:none 无法量宽，临时显示为 inline-flex 同步测量后立即还原（同一帧内不闪屏）
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

// positioner 被 Teleport 到 .canvas（可跨 zoom 空间定位），已不在 .editor-wrapper 内，
// 而 store 解析靠 aria-ui context 事件在 DOM 上冒泡，必须从 positioner 自身派发；
// 同一画布可有多个编辑器，故按 data-owner（所属块 id，随 popup 一起绑定）在 .canvas 里找回对应的那个
export function findPositionerEl(view: any): HTMLElement | null {
  const wrapper = view?.dom?.closest?.('.editor-wrapper') as HTMLElement | null
  const inWrapper = wrapper?.querySelector('.block-handle-positioner') as HTMLElement | null
  if (inWrapper) return inWrapper
  const id = (view?.dom?.closest?.('.drag-wrapper') as HTMLElement | null)?.dataset.id
  if (!id) return null
  return document.querySelector<HTMLElement>(`.block-handle-positioner[data-owner="${id}"]`)
}

// ProseKit 未公开 BlockHandleStore API，经 aria-ui context 冒泡事件取 provider 回调返回 store；
// 每个编辑器 store 独立，用闭包按实例缓存
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

// overlay store 持有浮层的 anchorElement，可直接换成"指向当前行的动态参考"，
// 让 floating-ui 的 autoUpdate 自行逐帧重算位置（无需每帧重设 hover 状态）
export function createOverlayStoreResolver() {
  return createContextResolver('aria-ui:context:prosekit-block-handle-overlay-store')
}

// 跳过 ProseKit 的节流与失效缓冲立即关闭 popup，直接清 store 的 hoverState
export function clearStoreHover(view: any, getStore: (el?: Element | null) => any): void {
  getStore(findPositionerEl(view))?.hoverState?.set(undefined)
}