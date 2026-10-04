import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Editor } from '@prosekit/core'
import { getBlockEl, getBlockRect, getCanvasViewportRect, getClipRect, getScrollEl, getVisibleBlockRectInViewport, findPositionerEl, getPopupHeight, getPopupWidth, getView, isCompactView, layoutToViewportSize, layoutToViewportX, layoutToViewportY, getRealPointer, viewportToLayout } from './blockHandleUtils'

export interface HoveredBlock {
  node: unknown
  pos: number
}

export function useHoverState(
  editor: Editor | null,
  dir: 'ltr' | 'rtl',
  getStore: (el?: Element | null) => any,
  getOverlayStore?: (el?: Element | null) => any,
) {
  // 拖拽/keepAlive 需拿最后一次 hover 的块作拖拽源，所以 hover 离开时不清空
  const hoveredBlock = ref<HoveredBlock | null>(null)
  const activeHover = ref<HoveredBlock | null>(null)

  // ProseKit 只认布局坐标、而真实指针是视口坐标，所以 zoom≠1 时拦下真实事件，改喂换算后的合成 pointermove
  const canvasZoom = ref(1)
  const placementVersion = ref(0)
  let placementScrollEl: HTMLElement | null = null

  const refreshPlacement = () => {
    if (hoveredBlock.value) placementVersion.value += 1
  }

  function zoomFromStyle(): number {
    const dom = getView(editor)?.dom as HTMLElement | undefined
    const parsed = Number.parseFloat(dom ? getComputedStyle(dom).getPropertyValue('--canvas-zoom') : '')
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  }

  // 逐帧读 computed style 会带来 N 次强制样式重算，所以优先取事件 detail 的 zoom，值未变则早返回
  const readCanvasZoom = (event?: Event) => {
    const detailZoom = (event as CustomEvent<{ zoom?: number }> | undefined)?.detail?.zoom
    const next = typeof detailZoom === 'number' && detailZoom > 0 ? detailZoom : zoomFromStyle()
    if (next === canvasZoom.value) return
    canvasZoom.value = next
    if (next === 1) stopKeepAlive()
    else if (activeHover.value) startKeepAlive()
  }

  // ProseKit 只给 pointermove 套了 throttle(200)，所以 pointermove/pointerenter 都发（后者另发 document 一份），否则 popup 位置滞后 200ms
  function forwardPointerMove(clientX: number, clientY: number, jitter = 0) {
    const view = getView(editor)
    const dom = view?.dom as HTMLElement | null
    if (!view || !dom) return
    const init: PointerEventInit = {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: viewportToLayout(view, clientX) + jitter,
      clientY: viewportToLayout(view, clientY) + jitter,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }
    dom.dispatchEvent(new PointerEvent('pointermove', init))
    const enterInit: PointerEventInit = { ...init, bubbles: false }
    dom.dispatchEvent(new PointerEvent('pointerenter', enterInit))
    document.dispatchEvent(new PointerEvent('pointerenter', enterInit))
  }

  // stateChange 在缩放环境偶发滞后，所以用事件目标 + posAtDOM 自解析；
  // 调 elementFromPoint 会变成每块×每事件的强制布局，所以复用事件目标做 O(1) 判定
  function rowAtElement(hit: HTMLElement): { row: HoveredBlock; el: HTMLElement } | null {
    const view = getView(editor)
    const dom = view?.dom as HTMLElement | null
    if (!view || !dom) return null
    let el: HTMLElement = hit
    while (el.parentElement && el.parentElement !== dom) el = el.parentElement
    if (el.parentElement !== dom) return null
    const at = view.posAtDOM(el, 0)
    const $pos = view.state.doc.resolve(at)
    const pos = $pos.depth === 0 ? at : $pos.before($pos.depth)
    const node = view.state.doc.nodeAt(pos)
    return node ? { row: { node, pos }, el } : null
  }

  const HOVER_UI_SELECTOR = '.block-handle-popup, .block-handle-positioner, .floating-handle, .side-settings, .handle'

  const storeOf = () => getStore(findPositionerEl(getView(editor)))
  const overlayOf = () => getOverlayStore?.(findPositionerEl(getView(editor)))

  let keepAliveTimer: ReturnType<typeof setInterval> | null = null
  let jitterFlip = false
  const stopKeepAlive = () => {
    if (keepAliveTimer) clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
  const startKeepAlive = () => {
    if (canvasZoom.value === 1 || keepAliveTimer) return
    keepAliveTimer = setInterval(() => {
      const { x, y } = getRealPointer()
      if (Number.isNaN(x)) return
      jitterFlip = !jitterFlip
      forwardPointerMove(x, y, jitterFlip ? 0.4 : 0.8)
    }, 150)
  }

  // autoUpdate 会自行重算矩形，所以无需每个 pointermove 重设 hover 状态
  function makeRowAnchor(el: HTMLElement) {
    const getVisibleAnchor = () => {
      const view = getView(editor)
      const rect = getVisibleBlockRectInViewport(view, el)
      if (!view || !rect) return new DOMRect(0, 0, 0, 0)
      return new DOMRect(
        viewportToLayout(view, rect.left),
        viewportToLayout(view, rect.top),
        viewportToLayout(view, rect.width),
        viewportToLayout(view, rect.height),
      )
    }
    return {
      contextElement: el,
      getBoundingClientRect: getVisibleAnchor,
    }
  }

  // stateChange 不可靠，所以独立按指针位置自解析并直接写 store（同步派发 stateChange，拖拽源稳定）
  const HOVER_CLEAR_DELAY = 150
  let hoverClearTimer: ReturnType<typeof setTimeout> | null = null
  const cancelHoverClear = () => {
    if (!hoverClearTimer) return
    clearTimeout(hoverClearTimer)
    hoverClearTimer = null
  }

  const onPointerResolve = (event: PointerEvent) => {
    if (!event.isTrusted) return
    const target = event.target as HTMLElement | null
    const dom = getView(editor)?.dom as HTMLElement | null
    if (!dom) return
    const hit = target && dom.contains(target) ? rowAtElement(target) : null
    if (hit) {
      cancelHoverClear()
      hoveredBlock.value = hit.row
      activeHover.value = hit.row
      startKeepAlive()
      storeOf()?.hoverState?.set(hit.row)
      overlayOf()?.setAnchorElement?.(makeRowAnchor(hit.el))
      return
    }
    // 指针在浮层（popup/手柄）上：保持 hover
    if (target?.closest?.(HOVER_UI_SELECTOR)) {
      cancelHoverClear()
      return
    }
    // 立即清会让 popup 变 pointer-events:none、鼠标扫到空隙就上不去，所以延迟清空
    if (hoverClearTimer) return
    hoverClearTimer = setTimeout(() => {
      hoverClearTimer = null
      activeHover.value = null
      stopKeepAlive()
    }, HOVER_CLEAR_DELAY)
  }

  const onZoomPointerMove = (event: PointerEvent) => {
    // 伪 pointermove 坐标是 -9999，所以不能当作指针位置
    if (!event.isTrusted || canvasZoom.value === 1) return
    const view = getView(editor)
    if (!view?.dom) return
    // 真实事件带视口坐标、且处理在合成事件之后会覆盖 popup 位置，所以须 stopPropagation（拖拽监听同节点捕获阶段，不受影响）
    event.stopPropagation()
    forwardPointerMove(event.clientX, event.clientY)
  }

  onMounted(() => {
    readCanvasZoom()
    placementScrollEl = getScrollEl(getView(editor))
    placementScrollEl?.addEventListener('scroll', refreshPlacement, { passive: true })
    window.addEventListener('resize', refreshPlacement)
    window.addEventListener('Mindrizzle:canvas-transform', refreshPlacement)
    window.addEventListener('pointermove', onZoomPointerMove, true)
    window.addEventListener('pointermove', onPointerResolve, true)
    window.addEventListener('Mindrizzle:canvas-transform', readCanvasZoom)
  })

  onUnmounted(() => {
    placementScrollEl?.removeEventListener('scroll', refreshPlacement)
    window.removeEventListener('resize', refreshPlacement)
    window.removeEventListener('Mindrizzle:canvas-transform', refreshPlacement)
    window.removeEventListener('pointermove', onZoomPointerMove, true)
    window.removeEventListener('pointermove', onPointerResolve, true)
    window.removeEventListener('Mindrizzle:canvas-transform', readCanvasZoom)
    cancelHoverClear()
    stopKeepAlive()
  })

  function onBlockStateChange(event: Event) {
    const detail = (event as CustomEvent).detail as HoveredBlock | null
    // 拖拽需跨编辑器全局抑制 popup/高亮
    if (document.body.classList.contains('block-handle-dragging')) {
      activeHover.value = null
      stopKeepAlive()
      return
    }
    // 指针可能正停在 popup/手柄上，所以空 hover 不直接清空，显隐交给 onPointerResolve 管理
    if (!detail) {
      stopKeepAlive()
      return
    }
    activeHover.value = detail
    hoveredBlock.value = detail
    startKeepAlive()
  }

  // 留出 4px 余量，避免空间判断被边界像素误差影响
  const COMPACT_POPUP_GAP = 4

  type PopupPlacement = 'left' | 'right' | 'top' | 'bottom'
  type PlacementSpaces = Record<PopupPlacement, number>

  const horizontalPlacementOf = (view: any, fallback: 'left' | 'right'): 'left' | 'right' => {
    const editorDom = view?.dom as HTMLElement | null
    const widget = editorDom?.closest('.drag-wrapper') as HTMLElement | null
    const container = editorDom?.closest('.canvas-container') as HTMLElement | null
    if (!widget || !container) return fallback
    const widgetRect = widget.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const left = layoutToViewportX(view, widgetRect.left)
    const right = layoutToViewportX(view, widgetRect.right)
    return (left + right) / 2 < (containerRect.left + containerRect.right) / 2 ? 'right' : 'left'
  }

  const placementOrderOf = (view: any, fallback: 'left' | 'right'): PopupPlacement[] => {
    if (isCompactView(view)) return ['top', 'bottom', 'left', 'right']
    const preferred = horizontalPlacementOf(view, fallback)
    const opposite = preferred === 'left' ? 'right' : 'left'
    return [preferred, opposite, 'top', 'bottom']
  }

  const prioritizeVisibleEdges = (
    full: DOMRect | null,
    clip: DOMRect,
    order: PopupPlacement[],
  ): PopupPlacement[] => {
    if (!full) return order
    const clipped: PopupPlacement[] = []
    if (full.top < clip.top) clipped.push('bottom')
    if (full.bottom > clip.bottom) clipped.push('top')
    if (full.left < clip.left) clipped.push('right')
    if (full.right > clip.right) clipped.push('left')
    return [...new Set([...clipped, ...order])]
  }

  const choosePlacement = (
    spaces: PlacementSpaces,
    needs: PlacementSpaces,
    order: PopupPlacement[],
  ): PopupPlacement => {
    const fitting = order.find((placement) => spaces[placement] >= needs[placement])
    if (fitting) return fitting
    return order.reduce((best, placement) =>
      spaces[placement] / needs[placement] > spaces[best] / needs[best] ? placement : best,
    )
  }

  const fullBlockRectInViewport = (view: any, pos: number): DOMRect | null => {
    const rect = getBlockRect(view, pos)
    if (!rect) return null
    const left = layoutToViewportX(view, rect.left)
    const top = layoutToViewportY(view, rect.top)
    return new DOMRect(
      left,
      top,
      layoutToViewportSize(view, rect.width),
      layoutToViewportSize(view, rect.height),
    )
  }

  const handlePlacement = computed<'left' | 'right' | 'top' | 'bottom'>(() => {
    void placementVersion.value
    const fallback: 'left' | 'right' = dir === 'rtl' ? 'right' : 'left'
    if (!hoveredBlock.value) return fallback

    const view = getView(editor)
    const pos = hoveredBlock.value.pos
    const row = getVisibleBlockRectInViewport(view, getBlockEl(view, pos))
    if (!view || !row) return fallback
    const clip = getClipRect(view)
    const popupBounds = getCanvasViewportRect(view)
    const needX = layoutToViewportSize(view, getPopupWidth(view)) + COMPACT_POPUP_GAP
    const needY = layoutToViewportSize(view, getPopupHeight(view)) + COMPACT_POPUP_GAP
    const spaces: PlacementSpaces = {
      left: row.left - popupBounds.left,
      right: popupBounds.right - row.right,
      top: row.top - popupBounds.top,
      bottom: popupBounds.bottom - row.bottom,
    }
    const needs: PlacementSpaces = { left: needX, right: needX, top: needY, bottom: needY }
    return choosePlacement(spaces, needs, prioritizeVisibleEdges(fullBlockRectInViewport(view, pos), clip, placementOrderOf(view, fallback)))
  })

  return { hoveredBlock, activeHover, handlePlacement, onBlockStateChange }
}
