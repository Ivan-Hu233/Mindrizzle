import { computed, ref, watch, onUnmounted } from 'vue'
import type { Editor } from '@prosekit/core'
import type { Ref } from 'vue'
import { dispatchBlockHover, getBlockEl, getBlockRect, getRealPointer, getScrollEl, getView, getVisibleBlockRectInViewport, isCompactView, isPointerInsideRect } from './blockHandleUtils'
import type { HoveredBlock } from './useHoverState'

export function useHoverUi(options: {
  editor: Editor | null
  hoveredBlock: Ref<HoveredBlock | null>
  activeHover: Ref<HoveredBlock | null>
  placement: Ref<'left' | 'right' | 'top' | 'bottom'>
}) {
  const { editor, hoveredBlock, activeHover, placement } = options
  const view = () => getView(editor)

  // 给 PM 块加 class 会触发 mutation observer 重渲染并替换 popup 参考 DOM，所以高亮改用 fixed 覆盖层
  const highlightRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
  const highlightStyle = computed(() => {
    if (!highlightRect.value) return {}
    const { left, top, width, height } = highlightRect.value
    return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }
  })

  const popupShiftPx = ref(0)
  // 滚动条使文本右缘左移，所以按滚动条宽度补偿使左右对称
  const popupHShiftPx = ref(0)

  const popupKeep = ref(false)
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null

  // 编辑器嵌在块内拿不到画布选中态，所以由画布派发选中事件同步（重挂时按 selected 类兜底）
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
    // 拖拽中 popup/高亮已由 body 类全局隐藏，所以不更新
    const dragging = document.body.classList.contains('block-handle-dragging')
    const hover = dragging ? null : (handleVisible.value ? activeHover.value : null)
    const editorView = view()
    const scrollEl = getScrollEl(editorView)

    // 桌面端 left/right 放置时 popup 已贴行旁，所以仅 compact 或退化 top/bottom 时显示行高亮
    highlightRect.value = null
    if (hover && (isCompactView(view()) || placement.value === 'top' || placement.value === 'bottom')) {
      const r = getVisibleBlockRectInViewport(editorView, getBlockEl(editorView, hover.pos))
      if (r) {
        highlightRect.value = { left: r.left, top: r.top, width: r.width, height: r.height }
      }
    }

    popupShiftPx.value = 0

    // 仅 placement-right 锚定边受滚动条影响，所以只做水平补偿
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

  // popup 已 Teleport 到 .canvas（不在 wrapper 内），所以需延迟缓冲让鼠标有机会进入；
  // Chrome 会派发 relatedTarget 为 null 的 pointerleave，所以再按坐标复核命中
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
      // 指针可能在缓冲期内又移回（快出快回），触发时再按最近真实指针位置复核一次
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

  // ProseKit hover 纯指针驱动、失焦不会自动清 popup，所以监听 focusin/focusout 强制隐藏
  function onWrapperFocusIn() {
    forcedHidden.value = false
    updateHoverUi()
  }
  function onWrapperFocusOut(e: FocusEvent) {
    const related = e.relatedTarget as Node | null
    // 焦点可能仍在 popup 按钮上，所以不隐藏
    if ((related && wrapperBoundEl?.contains(related)) || isInteractiveTarget(related)) return
    suppressUI()
  }

  // 扩展 isHoverStateEqual 会跳过同块 hover，所以重新进入时解除 forcedHidden；同时须取消待定的延迟隐藏
  function onWrapperPointerEnter() {
    cancelHide()
    forcedHidden.value = false
    updateHoverUi()
  }
  // 高亮是 fixed 视口定位、需随画布重算，所以监听 MdrCanvas 的画布变换事件（首次 hover 时挂载）
  function onCanvasTransform() {
    // 平移中每帧派发，所以无 hover 时跳过可显著减负
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

  // 框选多块时会给无关块弹 handle，所以仅指针仍在最后一次 hover 的块内时重派
  function reassertHoverIfPointerInside() {
    const block = hoveredBlock.value
    if (!block || !isPointerInsideRect(getBlockRect(view(), block.pos))) return
    dispatchBlockHover(view(), block.pos)
  }

  watch([activeHover, forcedHidden, blockSelected], () => {
    if (!activeHover.value) {
      // 点击已清掉扩展 hover、popup 要等鼠标再动才出现，所以选中态翻为 true 时主动重派一次
      if (blockSelected.value) reassertHoverIfPointerInside()
      updateHoverUi()
      return
    }
    if (!view()?.dom) return
    ensureLeaveListener()
    ensureScrollListener()
    updateHoverUi()
  })

  // 直接 set hoverState 会被失效计时器清掉，所以向块 DOM 派发假 pointermove 让扩展自刷新
  function refreshHoverState() {
    const block = hoveredBlock.value
    if (block) dispatchBlockHover(view(), block.pos)
  }
  function startKeepAlive() {
    stopKeepAlive()
    refreshHoverState()
    // 扩展有 200ms 节流、单次刷新可能被吞，所以以 150ms 周期重试
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
    // 鼠标常只是从 popup 移回块内，所以不清 hover（否则 popup 闪烁）；真正离开由 pointerleave 兜底
  }

  // 直接清 store 会绕过 prevHoverState、导致 popup 无法再现，所以派发块外 pointermove+pointerout 走扩展缓冲
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
