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
  // 拖拽/keepAlive 需拿最后一次 hover 的块作拖拽源，hover 离开时不清空 hoveredBlock
  const hoveredBlock = ref<HoveredBlock | null>(null)
  const activeHover = ref<HoveredBlock | null>(null)

  // 编辑器 DOM 内元素的 getBoundingClientRect 处于 .canvas 的布局坐标（Chrome 下不含 CSS zoom），
  // 而 ProseKit 的 hover 命中/参考行/floating-ui 定位全部在布局坐标里自洽、只认事件坐标 ——
  // 真实指针事件是视口坐标，zoom≠1 时直接放行必然判为空命中（popup 位置冻结、不跟随）。
  // 故 zoom≠1 时拦下真实事件，改以换算成布局坐标的合成 pointermove 喂给编辑器 DOM，
  // 让命中、参考行、定位与 data-state/动画全部保持 ProseKit 原生表现（与 100% 一致）
  const canvasZoom = ref(1)
  const readCanvasZoom = () => {
    const dom = getView(editor)?.dom as HTMLElement | undefined
    const parsed = Number.parseFloat(dom ? getComputedStyle(dom).getPropertyValue('--canvas-zoom') : '')
    canvasZoom.value = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  }

  // 把视口指针坐标换算成 .canvas 布局坐标后转发给编辑器 DOM：zoom≠1 时真实事件在 ProseKit
  // 的布局坐标系里必然判错，合成事件让它的命中/参考行/定位全部自洽。
  // ProseKit 只给 pointermove 套了 throttle(200)，pointerenter 走同一命中处理且不节流，
  // 故两者都发（pointerenter 不冒泡，额外往 document 也发一份以防监听不在 view.dom 上），
  // 否则快速移动时 popup 位置会滞后最多 200ms、明显不如 100% 跟手
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

  // ProseKit 的 stateChange 在缩放环境偶发滞后（拖拽源 hoveredBlock 会空），
  // 故再用 elementFromPoint + posAtDOM 自解析一次，同时给出所在行元素供浮层做参考
  function resolveRowAtPointer(clientX: number, clientY: number): { row: HoveredBlock; el: HTMLElement } | null {
    const view = getView(editor)
    const dom = view?.dom as HTMLElement | null
    if (!view || !dom) return null
    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    if (!hit || !dom.contains(hit)) return null
    let el: HTMLElement = hit
    while (el.parentElement && el.parentElement !== dom) el = el.parentElement
    if (el.parentElement !== dom) return null
    const at = view.posAtDOM(el, 0)
    const $pos = view.state.doc.resolve(at)
    const pos = $pos.depth === 0 ? at : $pos.before($pos.depth)
    const node = view.state.doc.nodeAt(pos)
    return node ? { row: { node, pos }, el } : null
  }

  const isHoverUiTarget = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    return !!el?.closest?.('.block-handle-popup, .block-handle-positioner, .floating-handle, .side-settings, .handle')
  }

  const storeOf = () => getStore(findPositionerEl(getView(editor)))
  const overlayOf = () => getOverlayStore?.(findPositionerEl(getView(editor)))

  // floating-ui 的虚拟参考：矩形每次现算，缩放/平移/滚动时 autoUpdate 会自行重算，
  // 无需每个 pointermove 都重设 hover 状态（那会受 ProseKit 200ms 节流拖累而卡顿）
  function makeRowAnchor(el: HTMLElement) {
    return {
      contextElement: el,
      getBoundingClientRect: () => (el.isConnected ? el.getBoundingClientRect() : new DOMRect(0, 0, 0, 0)),
    }
  }

  // 拖拽源与 hover UI 需要稳定的"当前行"：ProseKit 的 stateChange 在缩放环境不可靠（会空）,
  // 故独立按指针位置自解析并直接写入 store（同步派发 stateChange，拖拽源稳定）
  const HOVER_CLEAR_DELAY = 150
  let hoverClearTimer: ReturnType<typeof setTimeout> | null = null
  const cancelHoverClear = () => {
    if (!hoverClearTimer) return
    clearTimeout(hoverClearTimer)
    hoverClearTimer = null
  }

  const onPointerResolve = (event: PointerEvent) => {
    if (!event.isTrusted) return
    const hit = resolveRowAtPointer(event.clientX, event.clientY)
    if (hit) {
      cancelHoverClear()
      hoveredBlock.value = hit.row
      activeHover.value = hit.row
      storeOf()?.hoverState?.set(hit.row)
      overlayOf()?.setAnchorElement?.(makeRowAnchor(hit.el))
      return
    }
    // 指针在浮层（popup/手柄）上：保持 hover
    if (isHoverUiTarget(event.clientX, event.clientY)) {
      cancelHoverClear()
      return
    }
    // 行外空白/画布其它位置：延迟清空。立即清会让 popup 变 pointer-events:none，
    // 鼠标从行移向 popup 时一旦扫到中间空隙就再也上不去了
    if (hoverClearTimer) return
    hoverClearTimer = setTimeout(() => {
      hoverClearTimer = null
      activeHover.value = null
    }, HOVER_CLEAR_DELAY)
  }

  const onZoomPointerMove = (event: PointerEvent) => {
    // 程序化伪 pointermove（清 hover 时坐标是 -9999）不能当作指针位置
    if (!event.isTrusted || canvasZoom.value === 1) return
    const view = getView(editor)
    if (!view?.dom) return
    // 必须拦下真实事件：它带的是视口坐标，ProseKit 在 .canvas 布局坐标系里判命中必然落空，
    // 且它的处理发生在合成事件之后，会把刚算好的 popup 位置又覆盖成错的。
    // 各拖拽/框选监听都注册在 window 捕获阶段（同节点，不受 stopPropagation 影响），不会因此失效
    event.stopPropagation()
    forwardPointerMove(event.clientX, event.clientY)
  }

  onMounted(() => {
    readCanvasZoom()
    window.addEventListener('pointermove', onZoomPointerMove, true)
    window.addEventListener('pointermove', onPointerResolve, true)
    window.addEventListener('Mindrizzle:canvas-transform', readCanvasZoom)
    // 位置由上面喂给 floating-ui 的动态参考驱动（逐帧自算，跟手），这里只负责
    // 以 150ms 周期刷新 ProseKit 的 hover 状态，抵御它 180ms 的失效清理
    keepAliveTimer = setInterval(() => {
      const { x, y } = getRealPointer()
      if (Number.isNaN(x)) return
      jitterFlip = !jitterFlip
      forwardPointerMove(x, y, jitterFlip ? 0.4 : 0.8)
    }, 150)
  })

  let keepAliveTimer: ReturnType<typeof setInterval> | null = null
  let jitterFlip = false

  onUnmounted(() => {
    window.removeEventListener('pointermove', onZoomPointerMove, true)
    window.removeEventListener('pointermove', onPointerResolve, true)
    window.removeEventListener('Mindrizzle:canvas-transform', readCanvasZoom)
    cancelHoverClear()
    if (keepAliveTimer) clearInterval(keepAliveTimer)
    keepAliveTimer = null
  })

  // 因鼠标停住时若光标下 DOM 被替换（画布提升层级/工具栏插入等），浏览器会派发坐标无意义的
  // pointerout（clientX/clientY 为 0），扩展按该坐标判为无块命中并在 180ms 后清 hover，
  // 表现为 popup 自己消失、必须再动鼠标才回来；故收到空 hover 时按真实指针位置复核
  function isPointerInsideBlock(block: HoveredBlock): boolean {
    const { x, y } = getRealPointer()
    if (Number.isNaN(x)) return false
    const rect = getBlockRect(getView(editor), block.pos)
    if (!rect) return false
    // 块矩形是布局坐标，真实指针是视口坐标，换算后再比
    const view = getView(editor)
    const left = layoutToViewportX(view, rect.left)
    const right = layoutToViewportX(view, rect.right)
    const top = layoutToViewportY(view, rect.top)
    const bottom = layoutToViewportY(view, rect.bottom)
    return x >= left && x <= right && y >= top && y <= bottom
  }

  function onBlockStateChange(event: Event) {
    const detail = (event as CustomEvent).detail as HoveredBlock | null
    // 拖拽需跨编辑器全局抑制 popup/高亮，通过 body 上的拖拽类判断
    if (document.body.classList.contains('block-handle-dragging')) {
      activeHover.value = null
      return
    }
    // 空 hover 不直接清空：指针可能正停在 popup/手柄上（ProseKit 只认编辑器内容命中），
    // 清空会让 popup 立刻变成 pointer-events:none 从而"一碰就闪"；显隐统一交给按指针命中判断的
    // onPointerResolve 管理（它区分行内/浮层，并对其它位置做 150ms 延迟清空）
    if (!detail) return
    activeHover.value = detail
    hoveredBlock.value = detail
  }

  // popup 需与行保持 4px 间距，放置判断以 popup 实际高度 + 该间距为所需空间
  const COMPACT_POPUP_GAP = 4

  // 放置规则：移动端优先上方、桌面端优先朝向画布内侧（块在左半 → 行右），空间不足时退化为另一侧/上下
  const handlePlacement = computed<'left' | 'right' | 'top' | 'bottom'>(() => {
    const fallback: 'left' | 'right' = dir === 'rtl' ? 'right' : 'left'
    if (!hoveredBlock.value) return fallback

    const view = getView(editor)
    if (isCompactView(view)) {
      // 行矩形与 popup 尺寸都是布局坐标，裁剪边界是视觉坐标，需统一换算后再比较
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
    // 无限画布下世界层远大于视口、按它判断内外会恒为同一侧，改用可见视口 .canvas-container 判断
    const container = editorDom?.closest('.canvas-container') as HTMLElement | null
    if (!widget || !container) return fallback
    // 块矩形是 .canvas 的布局坐标（不含 CSS zoom），容器/裁剪边界是视觉坐标，
    // 直接比较会在缩放时选错左右侧，统一换算到视觉坐标后再比
    const w = widget.getBoundingClientRect()
    const c = container.getBoundingClientRect()
    const wLeft = layoutToViewportX(view, w.left)
    const wRight = layoutToViewportX(view, w.left + w.width)
    const wTop = layoutToViewportY(view, w.top)
    const wBottom = layoutToViewportY(view, w.top + w.height)
    const preferred: 'left' | 'right' = wLeft + (wRight - wLeft) / 2 < c.left + c.width / 2 ? 'right' : 'left'

    // 桌面端左右放不下 popup 时需退化为上下放置；左右空间用整块边界（不用文本行 nodeDOM，
    // nodeDOM(pos) 部分情况取不到元素）；且桌面端 top/bottom 不放大，退化时大小与左右放置一致
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
