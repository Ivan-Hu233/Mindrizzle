// 基于 hover 的 UI：移动端行高亮 + popup 常驻（keepAlive）+ 快速关闭。
// 通过 pointerleave / scroll 监听，保证高亮随滚动同步、鼠标移出即关闭。

import { computed, ref, watch, onUnmounted } from 'vue'
import type { Editor } from '@prosekit/core'
import type { Ref } from 'vue'
import { clearStoreHover, getBlockEl, getScrollEl, getView, isCompactView } from './blockHandleUtils'
import type { HoveredBlock } from './useHoverState'

export function useHoverUi(options: {
  editor: Editor | null
  hoveredBlock: Ref<HoveredBlock | null>
  activeHover: Ref<HoveredBlock | null>
  getStore: (el?: Element | null) => any
}) {
  const { editor, hoveredBlock, activeHover, getStore } = options
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

    // 高亮：块 rect 与滚动区可见 rect 求交集，完全不可见则不显示
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

    // 顶部被裁剪的偏移：popup 由 hoveredBlock 驱动（最后一次 hover）
    popupShiftPx.value = 0
    const hb = hoveredBlock.value
    if (hb && scrollEl) {
      const br = getBlockEl(view(), hb.pos)?.getBoundingClientRect()
      if (br) {
        const sr = scrollEl.getBoundingClientRect()
        popupShiftPx.value = br.top < sr.top ? Math.round(sr.top - br.top) : 0
      }
    }
  }

  // ---- 鼠标移出编辑器立即关闭 ----
  // ProseKit 的 hover 有 200ms 节流 + 180ms 失效缓冲（共约 380ms）才清 hoverState，
  // 这里监听内容 DOM 的 pointerleave，短缓冲后直接清，避免 popup/高亮延迟消失。
  let leaveTimer: ReturnType<typeof setTimeout> | null = null
  let leaveBound = false
  let scrollBoundEl: HTMLElement | null = null

  function onEditorPointerLeave() {
    if (leaveTimer) return
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      highlightRect.value = null
      clearStoreHover(view(), getStore)
    }, 100) // 短缓冲：给“从块移到 popup（两者有间隙）”留时间，避免闪烁
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
    clearStoreHover(view(), getStore) // 防 hoverState 残留导致 popup 一直显示
  }

  /** 拖拽开始等场景：整体关闭 popup、高亮与 hoverState。 */
  function suppressUI() {
    popupKeep.value = false
    stopKeepAlive()
    highlightRect.value = null
    clearStoreHover(view(), getStore)
  }

  onUnmounted(() => {
    stopKeepAlive()
    cancelLeave()
    if (leaveBound) view()?.dom?.removeEventListener('pointerleave', onEditorPointerLeave)
    scrollBoundEl?.removeEventListener('scroll', updateHoverUi)
  })

  return { highlightRect, highlightStyle, popupShiftPx, popupKeep, onPopupEnter, onPopupLeave, suppressUI }
}
