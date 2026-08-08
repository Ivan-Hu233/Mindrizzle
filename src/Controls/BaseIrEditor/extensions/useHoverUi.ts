// 基于 hover 的 UI：移动端行高亮 + popup 常驻（keepAlive）+ 快速关闭。
// 通过 pointerleave / scroll 监听，保证高亮随滚动同步、鼠标移出即关闭。

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

  // ---- 移动端行高亮 ----
  // 高亮是 teleport 到 body 的 fixed 覆盖层：不能给 PM 块元素加 class，否则会触发
  // mutation observer 重渲染、替换掉 popup 参考 DOM 导致定位失效（飞到屏幕外）。
  const highlightRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
  const highlightStyle = computed(() => {
    if (!highlightRect.value) return {}
    const { left, top, width, height } = highlightRect.value
    return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }
  })

  // 行顶部被滚动裁剪时，popup 下移的偏移量（让 popup 紧贴高亮可见区）
  const popupShiftPx = ref(0)
  // 右侧 popup 的水平补偿：垂直滚动条会让文本右缘左移（clientWidth 变小），
  // 而 popup 锚定文本右缘，导致右侧 popup 随滚动条出现而偏移、与左侧不再对称。
  // 补偿滚动条宽度，让右侧 popup 始终贴齐块的外边缘（与左侧对称）。
  const popupHShiftPx = ref(0)

  // ---- popup 常驻（keepAlive）----
  const popupKeep = ref(false)
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null

  // 统一重算「高亮 rect（钳制到滚动区可见范围）」+「popup 下移偏移」。
  // hover 与滚动变化时都调用，保证高亮/放置与滚动同步。
  function updateHoverUi() {
    // 拖拽中不更新（popup 与高亮已被 body 类全局隐藏）
    const dragging = document.body.classList.contains('block-handle-dragging')
    const hover = dragging ? null : activeHover.value
    const scrollEl = getScrollEl(view())

    // 高亮：块 rect 与滚动区可见 rect 求交集，完全不可见则不显示。
    // 高亮带上缘的 2px 强调小条方向由 block-handle 模板按 placement 翻转：
    // popup 在行下方时（placement-bottom）小条翻到高亮下缘（反转，与上方对称）。
    highlightRect.value = null
    if (hover && isCompactView(view())) {
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

    // 裁剪补偿（仿照向上，上下对称）：
    // - placement-top：行顶部被滚动区裁掉时，把行上方的 popup 下移贴回可见区顶部；
    // - placement-bottom：行底部被滚动区裁掉时，把行下方的 popup 上移贴回可见区底部。
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

    // 右侧 popup 水平补偿（仅 placement-right 需要；left/top 锚定边不受滚动条影响）
    popupHShiftPx.value = placement.value === 'right' && scrollEl
      ? scrollEl.offsetWidth - scrollEl.clientWidth
      : 0
  }

  // ---- 鼠标移出编辑器立即关闭 ----
  // ProseKit 的 hover 有 200ms 节流 + 180ms 失效缓冲（共约 380ms）才清 hoverState，
  // 这里监听内容 DOM 的 pointerleave，短缓冲后直接清，避免 popup/高亮延迟消失。
  let leaveTimer: ReturnType<typeof setTimeout> | null = null
  let leaveBound = false
  let scrollBoundEl: HTMLElement | null = null
  let wrapperBoundEl: HTMLElement | null = null

  // 鼠标移出编辑器内容 DOM 时，短缓冲后主动清 hoverState。
  function onEditorPointerLeave() {
    if (leaveTimer) return
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      highlightRect.value = null
      clearHoverViaExtension()
    }, 100)
  }

  // 鼠标离开整个编辑器区域（内容 + popup gutter）时强制清理。
  // 覆盖「快速移过 popup 触发 keepAlive 后移出」的残留路径——此时仅靠 view.dom 的
  // pointerleave→clearHoverViaExtension 会被 keepAlive 的周期假 pointermove 重新设回，
  // 必须显式 stopKeepAlive + 关 popupKeep 才能真正清掉。
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

  // ---- popup keepAlive：鼠标在手柄上时保持 popup ----
  // 不能直接 set hoverState——ProseKit 的失效计时器会把它清掉。正确做法是向块 DOM
  // 派发假的 pointermove，让 useHoverExtension 自行刷新（会同步 clearTimeout + prevHoverState）。
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
    keepAliveTimer = setInterval(refreshHoverState, 150) // 有 200ms 节流，需周期重试
  }
  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
  }

  function onPopupEnter() {
    cancelLeave() // 取消“移出编辑器”的待清除定时，保留高亮与 popup
    popupKeep.value = true
    startKeepAlive()
  }
  function onPopupLeave() {
    popupKeep.value = false
    stopKeepAlive()
    clearHoverViaExtension()
  }

  // ---- 通过扩展路径清除 hoverState（替代直接 store.set(undefined)）----
  // 不能直接 clearStoreHover：那会绕过 useHoverExtension 内部的 prevHoverState，
  // 于是鼠标回到同一行时，扩展收到相同 hoverState 会因 isHoverStateEqual 直接
  // return，store 里仍是 undefined，popup 再也无法出现（即本次修复的问题）。
  // 正确做法是向内容 DOM 派发「位于所有块之外」的 pointermove + pointerout，
  // 让 handlePointerEvent 以 null 走一遍扩展自带的失效缓冲（180ms）正常清除：
  //   - pointermove：清掉 keepAlive 遗留的、指向块 L 的节流尾调用，避免它把失效计时取消
  //   - pointerout：立即触发一次 null 判定，启动失效计时
  // 若鼠标在 180ms 内回到某个块（如 popup→行），扩展会取消计时并重新持有该块，popup 保持。
  function clearHoverViaExtension() {
    const dom = view()?.dom
    if (!dom) return
    const emptyPoint = { bubbles: true, clientX: -9999, clientY: -9999, pointerId: 1 }
    dom.dispatchEvent(new PointerEvent('pointermove', emptyPoint))
    dom.dispatchEvent(new PointerEvent('pointerout', emptyPoint))
  }

  /** 拖拽开始等场景：整体关闭 popup、高亮与 hoverState。 */
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
