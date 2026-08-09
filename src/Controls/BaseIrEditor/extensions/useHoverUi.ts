import { computed, ref, watch, onUnmounted } from 'vue'
import type { Editor } from '@prosekit/core'
import type { Ref } from 'vue'
import { getBlockEl, getScrollEl, getView, isCompactView } from './blockHandleUtils'
import type { HoveredBlock } from './useHoverState'

export function useHoverUi(options: {
  editor: Editor | null
  hoveredBlock: Ref<HoveredBlock | null>
  activeHover: Ref<HoveredBlock | null>
  placement: Ref<'left' | 'right' | 'top' | 'bottom'>
}) {
  const { editor, hoveredBlock, activeHover, placement } = options
  const view = () => getView(editor)

  // 因给 PM 块元素加 class 会触发 mutation observer 重渲染、替换 popup 参考 DOM 导致定位失效，
  // 故高亮用 teleport 到 body 的 fixed 覆盖层实现
  const highlightRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
  const highlightStyle = computed(() => {
    if (!highlightRect.value) return {}
    const { left, top, width, height } = highlightRect.value
    return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }
  })

  const popupShiftPx = ref(0)
  // 因垂直滚动条使文本右缘左移、右侧 popup 锚定右缘会偏移而不对称，故按滚动条宽度补偿使左右对称
  const popupHShiftPx = ref(0)

  const popupKeep = ref(false)
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null

  function updateHoverUi() {
    // 因拖拽中 popup/高亮已由 body 类全局隐藏，故不更新
    const dragging = document.body.classList.contains('block-handle-dragging')
    const hover = dragging ? null : activeHover.value
    const scrollEl = getScrollEl(view())

    // 因桌面端 left/right 放置时 popup 已贴行旁无需行高亮，故仅 compact 或退化 top/bottom 时显示
    // （2px 强调小条方向由模板按 placement 翻转）
    highlightRect.value = null
    if (hover && (isCompactView(view()) || placement.value === 'top' || placement.value === 'bottom')) {
      const r = getBlockEl(view(), hover.pos)?.getBoundingClientRect()
      if (r && !(r.width === 0 && r.height === 0)) {
        if (scrollEl) {
          const sr = scrollEl.getBoundingClientRect()
          const left = Math.max(r.left, sr.left)
          const right = Math.min(r.right, sr.right)
          const top = Math.max(r.top, sr.top)
          const bottom = Math.min(r.bottom, sr.bottom)
          if (right > left && bottom > top) {
            highlightRect.value = { left, top, width: right - left, height: bottom - top }
          }
        } else {
          highlightRect.value = { left: r.left, top: r.top, width: r.width, height: r.height }
        }
      }
    }

    // 因行被滚动区裁掉时 popup 需贴回可见区，故 top 时下移、bottom 时上移（上下对称）
    popupShiftPx.value = 0
    const hb = hoveredBlock.value
    if (hb && scrollEl) {
      const br = getBlockEl(view(), hb.pos)?.getBoundingClientRect()
      if (br) {
        const sr = scrollEl.getBoundingClientRect()
        if (placement.value === 'top') {
          popupShiftPx.value = br.top < sr.top ? Math.round(sr.top - br.top) : 0
        } else if (placement.value === 'bottom') {
          popupShiftPx.value = br.bottom > sr.bottom ? Math.round(sr.bottom - br.bottom) : 0
        }
      }
    }

    // 因仅 placement-right 锚定边受滚动条影响，故只对右侧做水平补偿
    popupHShiftPx.value = placement.value === 'right' && scrollEl
      ? scrollEl.offsetWidth - scrollEl.clientWidth
      : 0
  }

  // 因 ProseKit hover 有约 380ms 节流/失效缓冲才清 hoverState，故监听内容 DOM 的
  // pointerleave 短缓冲后主动清，避免 popup/高亮延迟消失
  let leaveTimer: ReturnType<typeof setTimeout> | null = null
  let leaveBound = false
  let scrollBoundEl: HTMLElement | null = null
  let wrapperBoundEl: HTMLElement | null = null

  function onEditorPointerLeave() {
    if (leaveTimer) return
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      highlightRect.value = null
      clearHoverViaExtension()
    }, 100)
  }

  // 因快速移过 popup 触发 keepAlive 后移出时，仅靠 view.dom 的 pointerleave 会被
  // keepAlive 的周期假 pointermove 重新设回，故离开整个编辑器区域时显式
  // stopKeepAlive + 关 popupKeep 才能真正清掉
  function onWrapperPointerLeave() {
    cancelLeave()
    suppressUI()
  }
  function cancelLeave() {
    if (leaveTimer) {
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
  }

  function ensureLeaveListener() {
    const dom = view()?.dom
    if (leaveBound || !dom) return
    leaveBound = true
    dom.addEventListener('pointerleave', onEditorPointerLeave)
    const wrapper = dom.closest('.editor-wrapper') as HTMLElement | null
    if (wrapper) {
      wrapperBoundEl = wrapper
      wrapper.addEventListener('pointerleave', onWrapperPointerLeave)
    }
  }
  function ensureScrollListener() {
    const scrollEl = getScrollEl(view())
    if (scrollBoundEl || !scrollEl) return
    scrollBoundEl = scrollEl
    scrollEl.addEventListener('scroll', updateHoverUi, { passive: true })
  }

  watch(activeHover, () => {
    if (!activeHover.value) {
      updateHoverUi()
      return
    }
    if (!view()?.dom) return
    ensureLeaveListener()
    ensureScrollListener()
    cancelLeave()
    updateHoverUi()
  })

  // 因直接 set hoverState 会被 ProseKit 失效计时器清掉，故向块 DOM 派发假 pointermove
  // 让扩展自行刷新（同步清计时器与 prevHoverState）
  function refreshHoverState() {
    const block = hoveredBlock.value
    const dom = block ? getBlockEl(view(), block.pos) : null
    if (dom) {
      const r = dom.getBoundingClientRect()
      dom.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: r.x + 2,
          clientY: r.y + r.height / 2,
          pointerId: 1,
        }),
      )
    }
  }
  function startKeepAlive() {
    stopKeepAlive()
    refreshHoverState()
    keepAliveTimer = setInterval(refreshHoverState, 150) // 因扩展有 200ms 节流、单次刷新可能被吞，故以 150ms 周期重试
  }
  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
  }

  function onPopupEnter() {
    cancelLeave() // 因需保留高亮与 popup，故取消“移出编辑器”的待清除定时
    popupKeep.value = true
    startKeepAlive()
  }
  function onPopupLeave() {
    popupKeep.value = false
    stopKeepAlive()
    clearHoverViaExtension()
  }

  // 因直接 clearStoreHover 会绕过扩展内部 prevHoverState、鼠标回同一行时被 isHoverStateEqual
  // 跳过导致 popup 无法再现，故向 DOM 派发块外 pointermove+pointerout，走扩展自带失效缓冲正常清除
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
    clearHoverViaExtension()
  }

  onUnmounted(() => {
    stopKeepAlive()
    cancelLeave()
    if (leaveBound) view()?.dom?.removeEventListener('pointerleave', onEditorPointerLeave)
    wrapperBoundEl?.removeEventListener('pointerleave', onWrapperPointerLeave)
    scrollBoundEl?.removeEventListener('scroll', updateHoverUi)
  })

  return { highlightRect, highlightStyle, popupShiftPx, popupHShiftPx, popupKeep, onPopupEnter, onPopupLeave, suppressUI }
}
