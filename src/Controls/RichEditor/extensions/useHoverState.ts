import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Editor } from '@prosekit/core'
import { getBlockRect, getClipBottom, getClipTop, findPositionerEl, getPopupHeight, getPopupWidth, getView, isCompactView, layoutToViewportSize, layoutToViewportX, layoutToViewportY, getRealPointer, viewportToLayout } from './blockHandleUtils'

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
    return {
      contextElement: el,
      getBoundingClientRect: () => (el.isConnected ? el.getBoundingClientRect() : new DOMRect(0, 0, 0, 0)),
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
    window.addEventListener('pointermove', onZoomPointerMove, true)
    window.addEventListener('pointermove', onPointerResolve, true)
    window.addEventListener('Mindrizzle:canvas-transform', readCanvasZoom)
  })

  onUnmounted(() => {
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

  // popup 与行保持 4px 间距，放置判断按 popup 高度 + 该间距
  const COMPACT_POPUP_GAP = 4

  // 放置规则：移动端优先上方、桌面端优先朝向画布内侧（块在左半 → 行右），空间不足时退化为另一侧/上下
  const handlePlacement = computed<'left' | 'right' | 'top' | 'bottom'>(() => {
    const fallback: 'left' | 'right' = dir === 'rtl' ? 'right' : 'left'
    if (!hoveredBlock.value) return fallback

    const view = getView(editor)
    if (isCompactView(view)) {
      // 行矩形是布局坐标、裁剪边界是视觉坐标，所以需统一换算
      const br = getBlockRect(view, hoveredBlock.value.pos)
      if (br) {
        const need = layoutToViewportSize(view, getPopupHeight(view)) + COMPACT_POPUP_GAP
        const spaceAbove = layoutToViewportY(view, br.top) - getClipTop(view)
        const spaceBelow = getClipBottom(view) - layoutToViewportY(view, br.bottom)
        if (spaceAbove >= need) return 'top'
        if (spaceBelow >= need) return 'bottom'
        return spaceAbove >= spaceBelow ? 'top' : 'bottom'
      }
      return 'top'
    }

    const editorDom = view?.dom as HTMLElement | null
    const widget = editorDom?.closest('.drag-wrapper') as HTMLElement | null
    // 世界层远大于视口、按它判断内外恒为同一侧，所以改用 .canvas-container
    const container = editorDom?.closest('.canvas-container') as HTMLElement | null
    if (!widget || !container) return fallback
    // 块矩形是布局坐标、容器是视觉坐标，所以统一换算到视觉坐标后再比
    const w = widget.getBoundingClientRect()
    const c = container.getBoundingClientRect()
    const wLeft = layoutToViewportX(view, w.left)
    const wRight = layoutToViewportX(view, w.left + w.width)
    const wTop = layoutToViewportY(view, w.top)
    const wBottom = layoutToViewportY(view, w.top + w.height)
    const preferred: 'left' | 'right' = wLeft + (wRight - wLeft) / 2 < c.left + c.width / 2 ? 'right' : 'left'

    // nodeDOM(pos) 部分情况取不到元素，所以左右空间用整块边界；空间不足时退化为上下放置
    const needX = layoutToViewportSize(view, getPopupWidth(view)) + COMPACT_POPUP_GAP
    const spaceLeft = wLeft - c.left
    const spaceRight = c.right - wRight
    if (spaceLeft < needX && spaceRight < needX) {
      const br = getBlockRect(view, hoveredBlock.value.pos)
      const top = br ? layoutToViewportY(view, br.top) : wTop
      const bottom = br ? layoutToViewportY(view, br.bottom) : wBottom
      const needY = layoutToViewportSize(view, getPopupHeight(view)) + COMPACT_POPUP_GAP
      const spaceAbove = top - getClipTop(view)
      const spaceBelow = getClipBottom(view) - bottom
      if (spaceAbove >= needY) return 'top'
      if (spaceBelow >= needY) return 'bottom'
      return spaceAbove >= spaceBelow ? 'top' : 'bottom'
    }
    return preferred
  })

  return { hoveredBlock, activeHover, handlePlacement, onBlockStateChange }
}
