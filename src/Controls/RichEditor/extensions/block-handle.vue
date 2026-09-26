<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { mdiPlus, mdiDragVerticalVariant } from '@mdi/js'
import {
  BlockHandleAdd,
  BlockHandleDraggable,
  BlockHandlePopup,
  BlockHandlePositioner,
  BlockHandleRoot,
} from 'prosekit/vue/block-handle'
import type { Editor } from '@prosekit/core'
import { createOverlayStoreResolver, createStoreResolver, getScrollEl, getView } from './blockHandleUtils'
import { useHoverState } from './useHoverState'
import { useHoverUi } from './useHoverUi'
import { useBlockDrag } from './useBlockDrag'
import { activeHandleBlockId } from './blockHandleOwner'

interface Props {
  dir?: 'ltr' | 'rtl'
  editor?: Editor | null
  readOnly?: boolean
}
const props = defineProps<Props>()

// BlockHandleStore 每编辑器独立，按实例闭包缓存解析
const getStore = createStoreResolver()
const getOverlayStore = createOverlayStoreResolver()

const { hoveredBlock, activeHover, handlePlacement, onBlockStateChange } = useHoverState(
  props.editor ?? null,
  props.dir ?? 'ltr',
  getStore,
  getOverlayStore,
)
const {
  highlightRect,
  highlightStyle,
  popupShiftPx,
  popupHShiftPx,
  popupKeep,
  handleVisible,
  onPopupEnter,
  onPopupLeave,
  suppressUI,
} = useHoverUi({
  editor: props.editor ?? null,
  hoveredBlock,
  activeHover,
  placement: handlePlacement,
})
const { isDragging, onDragPointerDown } = useBlockDrag({
  editor: props.editor ?? null,
  hoveredBlock,
  suppressUI,
})

// 因 setup 阶段 editor 尚未挂载、closest('.drag-wrapper') 为空，故监听 editor 变化后再赋值
const blockId = ref<string | null>(null)
watch(
  () => props.editor,
  async () => {
    await nextTick()
    const wrapper = getView(props.editor)?.dom?.closest('.drag-wrapper') as HTMLElement | null
    blockId.value = wrapper?.dataset.id ?? null
  },
  { immediate: true },
)

// 因 computed 会因 editor 引用不变而取到过期的 null，故用函数实时查 DOM
const currentBlockId = () => getView(props.editor)?.dom?.closest('.drag-wrapper')?.dataset.id ?? null

// 任一实例改 owner 时其余实例立即收到更新并收起自己，保证只显示最后激活的块
watch(activeHandleBlockId, (ownerId) => {
  if (!ownerId) return
  const id = currentBlockId()
  if (id && ownerId !== id) suppressUI()
})

// 仅在确实显示时占有 owner，避免隐藏块残留占用
watch(handleVisible, (visible) => {
  const id = currentBlockId()
  if (visible && id) {
    activeHandleBlockId.value = id
  } else if (!visible && activeHandleBlockId.value === id) {
    activeHandleBlockId.value = null
  }
})

// 卸载时释放 owner，避免残留 id 阻塞其他块
onUnmounted(() => {
  if (activeHandleBlockId.value === currentBlockId()) {
    activeHandleBlockId.value = null
  }
})

// 因 popup 移到非首行时不盖 tm，故经双 rAF 量取实际矩形判断遮挡后再派发
function popupOverlapsTm(): boolean {
  const dom = getView(props.editor)?.dom as HTMLElement | null
  const wrapper = dom?.closest('.drag-wrapper') as HTMLElement | null
  if (!wrapper) return false
  // popup 已 Teleport 到 .canvas，此处全局查找
  const popup = document.querySelector<HTMLElement>('.block-handle-popup')
  const tm = wrapper.querySelector<HTMLElement>('.handle-tm')
  if (!popup || !tm) return false
  const pr = popup.getBoundingClientRect()
  const tr = tm.getBoundingClientRect()
  if (pr.width <= 0 || pr.height <= 0 || tr.width <= 0 || tr.height <= 0) return false
  return pr.left < tr.right && pr.right > tr.left && pr.top < tr.bottom && pr.bottom > tr.top
}

let tmSyncRaf = 0
function syncTmOverlap() {
  cancelAnimationFrame(tmSyncRaf)
  // 因 popup 位置由 floating-ui 异步更新，故双 rAF 确保量到最新位置
  tmSyncRaf = requestAnimationFrame(() => {
    tmSyncRaf = requestAnimationFrame(() => {
      const wrapper = getView(props.editor)?.dom?.closest('.drag-wrapper') as HTMLElement | null
      const blockId = wrapper?.dataset.id ?? null
      const open = !!handleVisible.value && popupOverlapsTm()
      window.dispatchEvent(new CustomEvent('Mindrizzle:block-popup', { detail: { open, blockId } }))
    })
  })
}

// tm 遮挡需随 hover 位置/显隐/放置方向/keepAlive 一起重算
watch([handleVisible, activeHover, popupKeep, handlePlacement], syncTmOverlap)

// 因 popup 上侧开启会盖住连接点曲别针，故派发事件通知画布隐藏
watch([handleVisible, handlePlacement], () => {
  const topOpen = !!handleVisible.value && handlePlacement.value === 'top'
  window.dispatchEvent(new CustomEvent('Mindrizzle:block-popup-top', { detail: { open: topOpen } }))
})

// 因鼠标移向 popup 会经过上方组件、焦点被切走会让 popup 消失，故派发"该块 popup 激活"让画布暂停 hover 聚焦
watch(handleVisible, (visible) => {
  const wrapper = getView(props.editor)?.dom?.closest('.drag-wrapper') as HTMLElement | null
  const blockId = wrapper?.dataset.id ?? null
  window.dispatchEvent(new CustomEvent('Mindrizzle:block-handle-active', { detail: { active: !!visible, blockId } }))
})

// 因滚动条是 overlay（原生已隐藏，offsetWidth-clientWidth 恒为 0），popup 压住滚动条时 wheel 滚不动，
// 故按滚动条元素矩形判定并手动转发 delta
const LINE_HEIGHT = 16
const onPopupWheel = (e: WheelEvent) => {
  const scrollEl = getScrollEl(getView(props.editor))
  const shell = scrollEl?.closest('.editor-scroll-shell')
  if (!scrollEl || !shell) return

  const isOnBar = (selector: string) => {
    const bar = shell.querySelector(selector)
    if (!bar) return false
    const r = bar.getBoundingClientRect()
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  }
  const unitOf = (extent: number) =>
    e.deltaMode === 2 ? extent : e.deltaMode === 1 ? LINE_HEIGHT : 1

  if (isOnBar('.custom-scrollbar-vertical')) {
    scrollEl.scrollTop += e.deltaY * unitOf(scrollEl.clientHeight)
  } else if (isOnBar('.custom-scrollbar-horizontal')) {
    scrollEl.scrollLeft += (e.deltaX || e.deltaY) * unitOf(scrollEl.clientWidth)
  } else {
    return
  }
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <!-- 因 popup 在编辑器内受块层叠上下文限制，故把含 provider 的 Root 整体 Teleport 到 .canvas：store context 不丢、
       且 reference 与 floating-ui 同处布局坐标空间（放 .canvas-container 会随缩放偏移） -->
  <Teleport v-if="!props.readOnly" to=".canvas">
    <BlockHandleRoot @state-change="onBlockStateChange">
      <BlockHandlePositioner
        :placement="handlePlacement"
        :hide="false"
        :data-owner="blockId"
        :class="['block-handle-positioner', `placement-${handlePlacement}`, { interactive: handleVisible }]"
        :style="{ '--block-handle-shift': popupShiftPx + 'px', '--block-handle-hshift': popupHShiftPx + 'px' }"
        @pointerenter="onPopupEnter"
        @pointerleave="onPopupLeave"
      >
      <BlockHandlePopup
        class="block-handle-popup"
        :data-block-id="blockId"
        :class="{ 'popup-keep': popupKeep, 'forced-open': handleVisible, 'ui-hidden': !handleVisible }"
        @pointerenter="onPopupEnter"
        @pointerleave="onPopupLeave"
        @wheel="onPopupWheel"
      >
        <BlockHandleAdd class="block-handle-btn">
          <v-icon :icon="mdiPlus" size="20" />
        </BlockHandleAdd>
        <BlockHandleDraggable
          class="block-handle-btn block-handle-drag"
          @pointerdown.prevent="onDragPointerDown"
        >
          <v-icon :icon="mdiDragVerticalVariant" size="20" />
        </BlockHandleDraggable>
      </BlockHandlePopup>
      </BlockHandlePositioner>
    </BlockHandleRoot>
  </Teleport>

  <!-- 因 .vdr 的 transform/overflow 会裁剪 fixed 高亮，故 Teleport 到 body -->
  <Teleport to="body">
    <div v-if="highlightRect && !isDragging" class="block-handle-line-highlight" :class="`placement-${handlePlacement}`" :style="highlightStyle" />
  </Teleport>
</template>

<style scoped>
.block-handle-positioner {
  display: block;
  overflow: visible;
  width: min-content;
  height: min-content;
  /* 因 z-index 仅对定位元素生效，故显式 absolute；置 Z_LAYER.popup 保证在曲别针之上 */
  position: absolute;
  z-index: 1005;
  transition: transform 0.1s ease-out;
  pointer-events: none;
  inset: auto;
  /* 因 floating-ui 默认 -8px 会左移，故以 8px 抵消 */
  margin-left: 8px;
}

.block-handle-positioner.interactive {
  pointer-events: auto;
}

.block-handle-positioner.placement-right {
  margin-right: 8px;
}
.block-handle-positioner.placement-top {
  margin-left: 0;
  margin-top: 16px;
}

/* 因 floating-ui 在 bottom 时下移，故以负 margin-top 抵消使顶边紧贴行底 */
.block-handle-positioner.placement-bottom {
  margin-left: 0;
  margin-top: -4px;
}

@media (prefers-reduced-motion: reduce) {
  .block-handle-positioner {
    transition: none;
  }
}

.block-handle-popup {
  background-color: color-mix(in srgb, rgb(var(--v-theme-surface)) 90%, rgb(var(--v-theme-on-surface)) 10%);
  border-radius: 6px;
  margin-right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  pointer-events: auto;
  box-sizing: border-box;
  transition: opacity 0.1s, scale 0.1s;
  transform-origin: var(--transform-origin, center);
  opacity: 1;
  position: relative;
  z-index: 1;
}

/* 因 popup 与块间有空隙、鼠标经过会先触发失效清理，故用伪元素向块方向扩展透明桥接区 */
.block-handle-popup::before {
  content: '';
  position: absolute;
  pointer-events: auto;
}
.block-handle-positioner.placement-top .block-handle-popup::before {
  left: 0;
  right: 0;
  top: 100%;
  height: 48px;
}
.block-handle-positioner.placement-bottom .block-handle-popup::before {
  left: 0;
  right: 0;
  bottom: 100%;
  height: 48px;
}
.block-handle-positioner.placement-right .block-handle-popup::before {
  top: 0;
  bottom: 0;
  right: 100%;
  width: 48px;
}
.block-handle-positioner.placement-left .block-handle-popup::before {
  top: 0;
  bottom: 0;
  left: 100%;
  width: 48px;
}

/* 因滚动条使文本右缘左移、右侧 popup 偏移不对称，故按滚动条宽度推回 */
.block-handle-positioner.placement-right .block-handle-popup {
  margin-right: 0;
  margin-left: -6px;
  transform: translateX(var(--block-handle-hshift, 0px));
}

.block-handle-positioner.placement-top .block-handle-popup {
  margin-right: 0;
  margin-bottom: 12px;
  border-bottom-left-radius: 0px;
  border-bottom-right-radius: 0px;
}

.block-handle-positioner.placement-bottom .block-handle-popup {
  margin-right: 0;
  border-top-left-radius: 0px;
  border-top-right-radius: 0px;
}

@media (prefers-reduced-motion: reduce) {
  .block-handle-popup {
    transition: none;
  }
}

.block-handle-popup[data-state='closed'] {
  opacity: 0;
  scale: 0.95;
  transition-duration: 0.15s;
}

/* 因 hoverState 失效时 ProseKit 会隐藏 popup，故强制保持显示以可点击 ADD/拖拽 */
.block-handle-popup.popup-keep {
  opacity: 1 !important;
  scale: 1 !important;
  display: inline-flex !important;
  visibility: visible !important;
}

/* 因行在容器外时 ProseKit 会置 data-state=closed，故 handleVisible 时强制显示，位置由 popupShiftPx 贴回 */
.block-handle-popup.forced-open {
  opacity: 1 !important;
  scale: 1 !important;
  display: inline-flex !important;
  visibility: visible !important;
}

/* 因 display:none 会让尺寸变 0、floating-ui 在 0 与真实尺寸间跳变导致乱飞，故用 visibility/opacity 隐藏 */
.block-handle-popup.ui-hidden {
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

@starting-style {
  .block-handle-popup[data-state='open'] {
    opacity: 0;
    scale: 0.95;
  }
}

.block-handle-btn {
  position: relative;
  z-index: 1;
  min-height: 24px;
  min-width: 24px;
  height: 24px;
  width: 24px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 4px;
  color: rgba(var(--v-theme-on-surface), 0.38);
}

/* 因 ProseKit 注入 44×44 ::before 会扩大热区致点击位置不符，故禁用 */
.block-handle-btn::before,
.block-handle-btn::after {
  content: none !important;
}

.block-handle-btn:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.1);
}

:root[class*='dark'] .block-handle-btn:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
}

.block-handle-drag {
  z-index: 1;
  cursor: grab;
}

.block-handle-drag:active {
  cursor: grabbing;
}

.block-handle-line-highlight {
  position: fixed;
  left: 0;
  top: 0;
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.07);
  box-shadow: inset 0 2px 0 0 rgba(var(--v-theme-primary), 0.45);
  pointer-events: none;
  z-index: 9999;
}

/* placement-bottom 时强调小条翻转到下缘 */
.block-handle-line-highlight.placement-bottom {
  box-shadow: inset 0 -2px 0 0 rgba(var(--v-theme-primary), 0.45);
}

body.block-handle-dragging .block-handle-popup {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
body.block-handle-dragging .block-handle-line-highlight {
  display: none !important;
}
</style>
