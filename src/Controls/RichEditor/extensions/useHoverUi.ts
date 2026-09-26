import { computed, ref, watch, onUnmounted } from 'vue'
import type { Editor } from '@prosekit/core'
import type { Ref } from 'vue'
import { dispatchBlockHover, getBlockRect, getRealPointer, getScrollEl, getView, isCompactView, isPointerInsideRect, layoutToViewportX, layoutToViewportY, viewportToLayout } from './blockHandleUtils'
import type { HoveredBlock } from './useHoverState'

export function useHoverUi(options: {
  editor: Editor | null
  hoveredBlock: Ref<HoveredBlock | null>
  activeHover: Ref<HoveredBlock | null>
  placement: Ref<'left' | 'right' | 'top' | 'bottom'>
}) {
  const { editor, hoveredBlock, activeHover, placement } = options
  const view = () => getView(editor)

  // 因给 PM 块加 class 会触发 mutation observer 重渲染并替换 popup 参考 DOM，故高亮改用 fixed 覆盖层
  const highlightRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
  const highlightStyle = computed(() => {
    if (!highlightRect.value) return {}
    const { left, top, width, height } = highlightRect.value
    return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }
  })

  const popupShiftPx = ref(0)
  // 因滚动条使文本右缘左移，故按滚动条宽度补偿使左右对称
  const popupHShiftPx = ref(0)

  const popupKeep = ref(false)
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null

  // 因编辑器嵌在块内拿不到画布选中态，故由画布派发选中事件同步（重挂时按 selected 类兜底）
  const blockSelected = ref(false)

  function currentBlockId(): string | null {
    return (view()?.dom?.closest('.drag-wrapper') as HTMLElement | null)?.dataset.id ?? null
  }

  function onBlockSelectionChange(event: Event) {
    const ids = (event as CustomEvent<{ ids?: string[] }>).detail?.ids
    const id = currentBlockId()
    blockSelected.value = !!id && !!ids?.includes(id)
  }

  function syncBlockSelectedFromDom() {
    const wrapper = view()?.dom?.closest('.drag-wrapper') as HTMLElement | null
    blockSelected.value = !!wrapper?.classList.contains('selected')
  }

  window.addEventListener('Mindrizzle:block-selection', onBlockSelectionChange)

  const forcedHidden = ref(false)
  const handleVisible = computed(
    () => !forcedHidden.value && !!activeHover.value && blockSelected.value,
  )

  function updateHoverUi() {
    // 因拖拽中 popup/高亮已由 body 类全局隐藏，故不更新
    const dragging = document.body.classList.contains('block-handle-dragging')
    const hover = dragging ? null : (handleVisible.value ? activeHover.value : null)
    const scrollEl = getScrollEl(view())

    // 因桌面端 left/right 放置时 popup 已贴行旁，故仅 compact 或退化 top/bottom 时显示行高亮
    highlightRect.value = null
    if (hover && (isCompactView(view()) || placement.value === 'top' || placement.value === 'bottom')) {
      const r = getBlockRect(view(), hover.pos)
      if (r) {
        // 因高亮 fixed 且 z 极高会盖住工具栏，故 clamp 到画布容器与滚动容器（布局坐标需先换算）
        const clampEls = [scrollEl, view()?.dom?.closest?.('.canvas-container')].filter(Boolean) as HTMLElement[]
        let hlLeft = layoutToViewportX(view(), r.left), hlRight = layoutToViewportX(view(), r.right)
        let hlTop = layoutToViewportY(view(), r.top), hlBottom = layoutToViewportY(view(), r.bottom)
        for (const c of clampEls) {
          const cr = c.getBoundingClientRect()
          hlLeft = Math.max(hlLeft, cr.left)
          hlRight = Math.min(hlRight, cr.right)
          hlTop = Math.max(hlTop, cr.top)
          hlBottom = Math.min(hlBottom, cr.bottom)
        }
        if (hlRight > hlLeft && hlBottom > hlTop) {
          highlightRect.value = { left: hlLeft, top: hlTop, width: hlRight - hlLeft, height: hlBottom - hlTop }
        }
      }
    }

    // 因 popup 会被可见区裁掉，故按交集贴回可见区（top 下移、bottom 上移）
    popupShiftPx.value = 0
    const hb = hoveredBlock.value
    if (hb) {
      const br = getBlockRect(view(), hb.pos)
      if (br) {
        const clampEls = [scrollEl, view()?.dom?.closest?.('.canvas-container')].filter(Boolean) as HTMLElement[]
        const brTop = layoutToViewportY(view(), br.top)
        const brBottom = layoutToViewportY(view(), br.bottom)
        for (const c of clampEls) {
          const cr = c.getBoundingClientRect()
          // 因 popup 定位在 .canvas 布局空间，故偏移量须换算回布局 px（否则被 zoom 二次缩放）
          if (placement.value === 'top' && brTop < cr.top) {
            popupShiftPx.value = Math.max(popupShiftPx.value, Math.round(viewportToLayout(view(), cr.top - brTop)))
          } else if (placement.value === 'bottom' && brBottom > cr.bottom) {
            popupShiftPx.value = Math.max(popupShiftPx.value, Math.round(viewportToLayout(view(), cr.bottom - brBottom)))
          }
        }
      }
    }

    // 因仅 placement-right 锚定边受滚动条影响，故只做水平补偿
    popupHShiftPx.value = placement.value === 'right' && scrollEl
      ? scrollEl.offsetWidth - scrollEl.clientWidth
      : 0
  }

  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let leaveBound = false
  let scrollBoundEl: HTMLElement | null = null
  let wrapperBoundEl: HTMLElement | null = null

  function isInteractiveTarget(target: Node | null): boolean {
    const element = target as HTMLElement | null
    return !!element?.closest?.('.block-handle-popup, .v-overlay-container, .v-overlay, .v-menu, .v-list')
  }

  // 因 popup 已 Teleport 到 .canvas（不在 wrapper 内），故需延迟缓冲让鼠标有机会进入；
  // 又因 Chrome 会派发 relatedTarget 为 null 的 pointerleave，故再按坐标复核命中
  function isPointerStillOnEditor(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return false
    return !!wrapperBoundEl?.contains(el) || isInteractiveTarget(el)
  }

  function onWrapperPointerLeave(event: PointerEvent) {
    const relatedTarget = event.relatedTarget as Node | null
    if (wrapperBoundEl?.contains(relatedTarget) || isInteractiveTarget(relatedTarget)) {
      cancelHide()
      return
    }
    if (isPointerStillOnEditor(event.clientX, event.clientY)) {
      cancelHide()
      return
    }
    if (hideTimer) return
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (popupKeep.value) return
      // 因指针可能在缓冲期内又移回（快出快回），触发时再按最近真实指针位置复核一次
      const { x, y } = getRealPointer()
      if (!Number.isNaN(x) && isPointerStillOnEditor(x, y)) return
      suppressUI()
    }, 400)
  }
  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  // 因 ProseKit hover 纯指针驱动、失焦不会自动清 popup，故监听 focusin/focusout 强制隐藏
  function onWrapperFocusIn() {
    forcedHidden.value = false
    updateHoverUi()
  }
  function onWrapperFocusOut(e: FocusEvent) {
    const related = e.relatedTarget as Node | null
    // 因焦点可能仍在 popup 按钮上，故不隐藏
    if ((related && wrapperBoundEl?.contains(related)) || isInteractiveTarget(related)) return
    suppressUI()
  }

  // 因扩展 isHoverStateEqual 会跳过同块 hover，故重新进入时解除 forcedHidden；同时须取消待定的延迟隐藏
  function onWrapperPointerEnter() {
    cancelHide()
    forcedHidden.value = false
    updateHoverUi()
  }
  // 因高亮是 fixed 视口定位、需随画布重算，故监听 MdrCanvas 的画布变换事件（首次 hover 时挂载）
  function onCanvasTransform() {
    // 因平移中每帧派发，故无 hover 时跳过可显著减负
    if (!hoveredBlock.value && !activeHover.value) return
    updateHoverUi()
  }
  function ensureLeaveListener() {
    const dom = view()?.dom
    if (leaveBound || !dom) return
    leaveBound = true
    window.addEventListener('Mindrizzle:canvas-transform', onCanvasTransform)
    const wrapper = dom.closest('.editor-wrapper') as HTMLElement | null
    if (wrapper) {
      wrapperBoundEl = wrapper
      wrapper.addEventListener('pointerleave', onWrapperPointerLeave)
      wrapper.addEventListener('pointerenter', onWrapperPointerEnter)
      wrapper.addEventListener('focusin', onWrapperFocusIn)
      wrapper.addEventListener('focusout', onWrapperFocusOut)
      syncBlockSelectedFromDom()
    }
  }
  function ensureScrollListener() {
    const scrollEl = getScrollEl(view())
    if (scrollBoundEl || !scrollEl) return
    scrollBoundEl = scrollEl
    scrollEl.addEventListener('scroll', updateHoverUi, { passive: true })
  }

  // 因框选多块时会给无关块弹 handle，故仅指针仍在最后一次 hover 的块内时重派
  function reassertHoverIfPointerInside() {
    const block = hoveredBlock.value
    if (!block || !isPointerInsideRect(getBlockRect(view(), block.pos))) return
    dispatchBlockHover(view(), block.pos)
  }

  watch([activeHover, forcedHidden, blockSelected], () => {
    if (!activeHover.value) {
      // 因点击已清掉扩展 hover、popup 要等鼠标再动才出现，故选中态翻为 true 时主动重派一次
      if (blockSelected.value) reassertHoverIfPointerInside()
      updateHoverUi()
      return
    }
    if (!view()?.dom) return
    ensureLeaveListener()
    ensureScrollListener()
    updateHoverUi()
  })

  // 因直接 set hoverState 会被失效计时器清掉，故向块 DOM 派发假 pointermove 让扩展自刷新
  function refreshHoverState() {
    const block = hoveredBlock.value
    if (block) dispatchBlockHover(view(), block.pos)
  }
  function startKeepAlive() {
    stopKeepAlive()
    refreshHoverState()
    // 因扩展有 200ms 节流、单次刷新可能被吞，故以 150ms 周期重试
    keepAliveTimer = setInterval(refreshHoverState, 150)
  }
  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
  }

  function onPopupEnter() {
    cancelHide()
    popupKeep.value = true
    startKeepAlive()
  }
  function onPopupLeave() {
    popupKeep.value = false
    stopKeepAlive()
    // 因鼠标常只是从 popup 移回块内，故不清 hover（否则 popup 闪烁）；真正离开由 pointerleave 兜底
  }

  // 因直接清 store 会绕过 prevHoverState、导致 popup 无法再现，故派发块外 pointermove+pointerout 走扩展缓冲
  function clearHoverViaExtension() {
    const dom = view()?.dom
    if (!dom) return
    const emptyPoint = { bubbles: true, clientX: -9999, clientY: -9999, pointerId: 1 }
    dom.dispatchEvent(new PointerEvent('pointermove', emptyPoint))
    dom.dispatchEvent(new PointerEvent('pointerout', emptyPoint))
  }

  function suppressUI() {
    popupKeep.value = false
    stopKeepAlive()
    highlightRect.value = null
    forcedHidden.value = true
    clearHoverViaExtension()
  }

  onUnmounted(() => {
    stopKeepAlive()
    cancelHide()
    window.removeEventListener('Mindrizzle:block-selection', onBlockSelectionChange)
    if (leaveBound) {
      window.removeEventListener('Mindrizzle:canvas-transform', onCanvasTransform)
    }
    wrapperBoundEl?.removeEventListener('pointerleave', onWrapperPointerLeave)
    wrapperBoundEl?.removeEventListener('pointerenter', onWrapperPointerEnter)
    wrapperBoundEl?.removeEventListener('focusin', onWrapperFocusIn)
    wrapperBoundEl?.removeEventListener('focusout', onWrapperFocusOut)
    scrollBoundEl?.removeEventListener('scroll', updateHoverUi)
  })

  return { highlightRect, highlightStyle, popupShiftPx, popupHShiftPx, popupKeep, handleVisible, onPopupEnter, onPopupLeave, suppressUI }
}
