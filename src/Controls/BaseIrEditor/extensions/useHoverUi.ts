import { computed, ref, watch, onUnmounted } from 'vue'
import type { Editor } from '@prosekit/core'
import type { Ref } from 'vue'
import { dispatchBlockHover, getBlockRect, getRealPointer, getScrollEl, getView, isCompactView, isPointerInsideRect } from './blockHandleUtils'
import type { HoveredBlock } from './useHoverState'

export function useHoverUi(options: {
  editor: Editor | null
  hoveredBlock: Ref<HoveredBlock | null>
  activeHover: Ref<HoveredBlock | null>
  placement: Ref<'left' | 'right' | 'top' | 'bottom'>
}) {
  const { editor, hoveredBlock, activeHover, placement } = options
  const view = () => getView(editor)

  // 给 PM 块元素加 class 会触发 mutation observer 重渲染、替换 popup 参考 DOM 导致定位失效，
  // 高亮改用 teleport 到 body 的 fixed 覆盖层实现
  const highlightRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
  const highlightStyle = computed(() => {
    if (!highlightRect.value) return {}
    const { left, top, width, height } = highlightRect.value
    return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }
  })

  const popupShiftPx = ref(0)
  // 垂直滚动条使文本右缘左移、右侧 popup 锚定右缘会偏移而不对称，按滚动条宽度补偿使左右对称
  const popupHShiftPx = ref(0)

  const popupKeep = ref(false)
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null

  // 因 handle 只在块被选中时显示（选中由点击给出），而编辑器嵌在块内、拿不到画布选中态，
  // 故由画布派发选中事件同步；编辑器重挂可能错过事件，再按块元素上的 selected 类兜底
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

  // 行高亮与 block-handle 同步显隐统一由 handleVisible 判定（未被强制隐藏 + 存在 hover + 块已选中）
  const forcedHidden = ref(false)
  const handleVisible = computed(
    () => !forcedHidden.value && !!activeHover.value && blockSelected.value,
  )

  function updateHoverUi() {
    // 拖拽中 popup/高亮已由 body 类全局隐藏，不更新
    const dragging = document.body.classList.contains('block-handle-dragging')
    const hover = dragging ? null : (handleVisible.value ? activeHover.value : null)
    const scrollEl = getScrollEl(view())

    // 桌面端 left/right 放置时 popup 已贴行旁无需行高亮，仅 compact 或退化 top/bottom 时显示
    // （2px 强调小条方向由模板按 placement 翻转）
    highlightRect.value = null
    if (hover && (isCompactView(view()) || placement.value === 'top' || placement.value === 'bottom')) {
      const r = getBlockRect(view(), hover.pos)
      if (r) {
        // 高亮 fixed 到 body 且 z 极高，块被拖到画布外时高亮会盖住工具栏，
        // 同时 clamp 到画布容器可见区（工具栏之下）与编辑器滚动容器
        const clampEls = [scrollEl, view()?.dom?.closest?.('.canvas-container')].filter(Boolean) as HTMLElement[]
        let hlLeft = r.left, hlRight = r.right, hlTop = r.top, hlBottom = r.bottom
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

    // 行被画布容器/滚动区裁掉时 popup 会定位到可见区外被裁剪而显示不出，
    // 按两者交集把 popup 贴回可见区（top 时下移、bottom 时上移），与行高亮 clamp 一致
    popupShiftPx.value = 0
    const hb = hoveredBlock.value
    if (hb) {
      const br = getBlockRect(view(), hb.pos)
      if (br) {
        const clampEls = [scrollEl, view()?.dom?.closest?.('.canvas-container')].filter(Boolean) as HTMLElement[]
        for (const c of clampEls) {
          const cr = c.getBoundingClientRect()
          if (placement.value === 'top' && br.top < cr.top) {
            popupShiftPx.value = Math.max(popupShiftPx.value, Math.round(cr.top - br.top))
          } else if (placement.value === 'bottom' && br.bottom > cr.bottom) {
            popupShiftPx.value = Math.max(popupShiftPx.value, Math.round(cr.bottom - br.bottom))
          }
        }
      }
    }

    // 仅 placement-right 锚定边受滚动条影响，只对右侧做水平补偿
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

  // popup 已 Teleport 到 .canvas（不在 wrapper DOM 内），鼠标从 wrapper 移向 popup 时会先触发
  // wrapper 的 pointerleave；若立即 suppressUI 会把 popup 置为 pointer-events:none 导致鼠标到不了
  // popup，延迟缓冲让鼠标有机会进入 popup（onPopupEnter 置 popupKeep 并取消本定时），否则再隐藏
  // 因 Chrome 在光标下的 DOM 被替换（如 popup 挂载、块重渲染）时会派发 relatedTarget 为 null 的
  // pointerleave，只凭 relatedTarget 判断会把"指针仍在编辑器/popup 上"误判成移出而关掉 popup，
  // 故再按指针坐标复核一次命中元素
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

  // ProseKit hover 是纯指针驱动、编辑器失焦不会自动清 popup，
  // 监听 wrapper 的 focusin/focusout：焦点真正离开编辑器区域时强制同步隐藏 popup 与行高亮
  function onWrapperFocusIn() {
    forcedHidden.value = false
    updateHoverUi()
  }
  function onWrapperFocusOut(e: FocusEvent) {
    const related = e.relatedTarget as Node | null
    // 焦点仍在编辑器区域内（如 popup 按钮等）时不隐藏
    if ((related && wrapperBoundEl?.contains(related)) || isInteractiveTarget(related)) return
    suppressUI()
  }

  // 移出编辑器后同块 hover 不会重发 state-change（扩展 isHoverStateEqual 直接跳过），
  // 鼠标重新进入 wrapper 时解除 forcedHidden，让 popup/高亮可随 hover 恢复；
  // 同时必须取消移出时排的延迟隐藏，否则"快速移出→移回"会在 400ms 后被那次待定隐藏关掉 popup
  function onWrapperPointerEnter() {
    cancelHide()
    forcedHidden.value = false
    updateHoverUi()
  }  // 画布平移/缩放会改变块视口位置而高亮是 fixed 视口定位，需随画布重算，
  // 监听 MdrCanvas 派发的画布变换事件（首次 hover 时才挂载）；
  // MdrCanvas 用 post flush 派发（渲染完成、.canvas 变换已落到 DOM），此处直接重算即可
  function onCanvasTransform() {
    // 无 hover 的编辑器高亮/popup 均未显示，平移中每帧派发下跳过可显著减负（块多时收益明显）
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

  // 仅当真实指针仍在"最后一次 hover 的块"内时才重派，避免框选多个块时给无关块弹出 handle
  function reassertHoverIfPointerInside() {
    const block = hoveredBlock.value
    if (!block || !isPointerInsideRect(getBlockRect(view(), block.pos))) return
    dispatchBlockHover(view(), block.pos)
  }

  // handleVisible 依赖强制隐藏态与选中态，其变化时也需重算行高亮与 popup 显隐
  watch([activeHover, forcedHidden, blockSelected], () => {
    if (!activeHover.value) {
      // 因点击选中时指针已在块内、但扩展的 hover 已被本次点击清掉，popup 要等鼠标再动才出现，
      // 故选中态翻为 true 时复核指针位置并主动重派一次 hover
      if (blockSelected.value) reassertHoverIfPointerInside()
      updateHoverUi()
      return
    }
    if (!view()?.dom) return
    ensureLeaveListener()
    ensureScrollListener()
    updateHoverUi()
  })

  // 直接 set hoverState 会被 ProseKit 失效计时器清掉，向块 DOM 派发假 pointermove
  // 让扩展自行刷新（同步清计时器与 prevHoverState）
  function refreshHoverState() {
    const block = hoveredBlock.value
    if (block) dispatchBlockHover(view(), block.pos)
  }
  function startKeepAlive() {
    stopKeepAlive()
    refreshHoverState()
    keepAliveTimer = setInterval(refreshHoverState, 150) // 扩展有 200ms 节流、单次刷新可能被吞，以 150ms 周期重试
  }
  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
  }

  function onPopupEnter() {
    cancelHide() // 鼠标已进入 popup，取消 wrapper 缓冲后的延迟隐藏
    popupKeep.value = true
    startKeepAlive()
  }
  function onPopupLeave() {
    popupKeep.value = false
    stopKeepAlive()
    // 因鼠标常只是从 popup 移回块内（popup 与块之间只有几像素），
    // 此处若清 hover 会把 popup 关掉、要等下一次 pointermove（扩展有 200ms 节流）才恢复，表现为 popup 闪烁；
    // 真正离开块由 wrapper 的 pointerleave → suppressUI 兜底
  }

  // 直接 clearStoreHover 会绕过扩展内部 prevHoverState、鼠标回同一行时被 isHoverStateEqual
  // 跳过导致 popup 无法再现，向 DOM 派发块外 pointermove+pointerout，走扩展自带失效缓冲正常清除
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
