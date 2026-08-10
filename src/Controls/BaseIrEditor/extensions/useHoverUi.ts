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

  // 因需"富文本框失焦时强制隐藏 block-handle"，且"行高亮与 block-handle 同步显隐"，
  // 故统一由 handleVisible 判定显隐（编辑器聚焦 + 未被强制隐藏 + 存在 hover）；
  // 桌面端 left/right 不放行高亮属于例外，见 updateHoverUi
  const editorFocused = ref(false)
  const forcedHidden = ref(false)
  const handleVisible = computed(
    () => !!editorFocused.value && !forcedHidden.value && !!activeHover.value,
  )

  function updateHoverUi() {
    // 因拖拽中 popup/高亮已由 body 类全局隐藏，故不更新
    const dragging = document.body.classList.contains('block-handle-dragging')
    const hover = dragging ? null : (handleVisible.value ? activeHover.value : null)
    const scrollEl = getScrollEl(view())

    // 因桌面端 left/right 放置时 popup 已贴行旁无需行高亮，故仅 compact 或退化 top/bottom 时显示
    // （2px 强调小条方向由模板按 placement 翻转）
    highlightRect.value = null
    if (hover && (isCompactView(view()) || placement.value === 'top' || placement.value === 'bottom')) {
      const r = getBlockEl(view(), hover.pos)?.getBoundingClientRect()
      if (r && !(r.width === 0 && r.height === 0)) {
        // 因高亮 fixed 到 body 且 z 极高，块被拖到画布外时高亮会盖住工具栏，
        // 故同时 clamp 到画布容器可见区（工具栏之下）与编辑器滚动容器
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

    // 因行被画布容器/滚动区裁掉时 popup 会定位到可见区外被裁剪而显示不出，
    // 故按两者交集把 popup 贴回可见区（top 时下移、bottom 时上移），与行高亮 clamp 一致
    popupShiftPx.value = 0
    const hb = hoveredBlock.value
    if (hb) {
      const br = getBlockEl(view(), hb.pos)?.getBoundingClientRect()
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
    // 因行高亮需与 block-handle 同步消失（都在 activeHover 清空时由 handleVisible 触发），
    // 故此处不再单独清 highlightRect，仅提前走扩展失效缓冲，避免高亮先消失而 popup 残留
    leaveTimer = setTimeout(() => {
      leaveTimer = null
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

  // 因 ProseKit hover 是纯指针驱动、编辑器失焦不会自动清 popup，
  // 故监听 wrapper 的 focusin/focusout：焦点真正离开编辑器区域时强制同步隐藏 popup 与行高亮
  function onWrapperFocusIn() {
    editorFocused.value = true
    forcedHidden.value = false
    updateHoverUi()
  }
  function onWrapperFocusOut(e: FocusEvent) {
    const related = e.relatedTarget as Node | null
    // 焦点仍在编辑器区域内（如 popup 按钮等）时不隐藏
    if (related && wrapperBoundEl && wrapperBoundEl.contains(related)) return
    editorFocused.value = false
    suppressUI()
  }

  // 因移出编辑器后同块 hover 不会重发 state-change（扩展 isHoverStateEqual 直接跳过），
  // 故鼠标重新进入 wrapper 时解除 forcedHidden，让 popup/高亮可随 hover 恢复
  function onWrapperPointerEnter() {
    forcedHidden.value = false
    updateHoverUi()
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
      wrapper.addEventListener('pointerenter', onWrapperPointerEnter)
      wrapper.addEventListener('focusin', onWrapperFocusIn)
      wrapper.addEventListener('focusout', onWrapperFocusOut)
      // 初始化聚焦态（编辑器挂载后可能已被聚焦，如移动端自动聚焦），据此设定初值
      editorFocused.value = wrapper.contains(document.activeElement)
    }
  }
  function ensureScrollListener() {
    const scrollEl = getScrollEl(view())
    if (scrollBoundEl || !scrollEl) return
    scrollBoundEl = scrollEl
    scrollEl.addEventListener('scroll', updateHoverUi, { passive: true })
  }

  // 因 handleVisible 依赖聚焦态/强制隐藏态，故这些变化时也需重算行高亮与 popup 显隐
  watch([activeHover, editorFocused, forcedHidden], () => {
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
    forcedHidden.value = true
    clearHoverViaExtension()
  }

  onUnmounted(() => {
    stopKeepAlive()
    cancelLeave()
    if (leaveBound) view()?.dom?.removeEventListener('pointerleave', onEditorPointerLeave)
    wrapperBoundEl?.removeEventListener('pointerleave', onWrapperPointerLeave)
    wrapperBoundEl?.removeEventListener('pointerenter', onWrapperPointerEnter)
    wrapperBoundEl?.removeEventListener('focusin', onWrapperFocusIn)
    wrapperBoundEl?.removeEventListener('focusout', onWrapperFocusOut)
    scrollBoundEl?.removeEventListener('scroll', updateHoverUi)
  })

  return { highlightRect, highlightStyle, popupShiftPx, popupHShiftPx, popupKeep, handleVisible, onPopupEnter, onPopupLeave, suppressUI }
}
