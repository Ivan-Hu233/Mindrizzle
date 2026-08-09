<script setup lang="ts">
import { watch } from 'vue'
import { mdiPlus, mdiDragVerticalVariant } from '@mdi/js'
import {
  BlockHandleAdd,
  BlockHandleDraggable,
  BlockHandlePopup,
  BlockHandlePositioner,
  BlockHandleRoot,
} from 'prosekit/vue/block-handle'
import type { Editor } from '@prosekit/core'
import { createStoreResolver, getView } from './blockHandleUtils'
import { useHoverState } from './useHoverState'
import { useHoverUi } from './useHoverUi'
import { useBlockDrag } from './useBlockDrag'

interface Props {
  dir?: 'ltr' | 'rtl'
  editor?: Editor | null
}
const props = defineProps<Props>()

// 因 ProseKit BlockHandleStore 每编辑器独立且各 composable 需共享，故按实例闭包缓存解析
const getStore = createStoreResolver()

const { hoveredBlock, activeHover, handlePlacement, onBlockStateChange } = useHoverState(
  props.editor ?? null,
  props.dir ?? 'ltr',
  getStore,
)
const {
  highlightRect,
  highlightStyle,
  popupShiftPx,
  popupHShiftPx,
  popupKeep,
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

// 因行高亮 popup 弹出时会插在块顶部正中间缩放手柄（.handle-tm）上方，故通知画布按 popup 显隐隐藏该块 tm
watch([activeHover, popupKeep], () => {
  if(handlePlacement.value != "top") return
  const open = !!activeHover.value || popupKeep.value
  const wrapper = getView(props.editor)?.dom?.closest('.drag-wrapper') as HTMLElement | null
  const blockId = wrapper?.dataset.id ?? null
  window.dispatchEvent(new CustomEvent('omnijot:block-popup', { detail: { open, blockId } }))
})
</script>

<template>
  <BlockHandleRoot @state-change="onBlockStateChange">
    <BlockHandlePositioner
      :placement="handlePlacement"
      :hide="false"
      :class="['block-handle-positioner', `placement-${handlePlacement}`]"
      :style="{ '--block-handle-shift': popupShiftPx + 'px', '--block-handle-hshift': popupHShiftPx + 'px' }"
    >
      <BlockHandlePopup
        class="block-handle-popup"
        :class="{ 'popup-keep': popupKeep, 'forced-open': !!activeHover }"
        @pointerenter="onPopupEnter"
        @pointerleave="onPopupLeave"
      >
        <BlockHandleAdd class="block-handle-btn">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
          >
            <path :d="mdiPlus" />
          </svg>
        </BlockHandleAdd>
        <BlockHandleDraggable
          class="block-handle-btn block-handle-drag"
          @pointerdown.prevent="onDragPointerDown"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
          >
            <path :d="mdiDragVerticalVariant" />
          </svg>
        </BlockHandleDraggable>
      </BlockHandlePopup>
    </BlockHandlePositioner>
  </BlockHandleRoot>

  <!-- 因 .vdr 的 transform/overflow 会裁剪 fixed 高亮，故 teleport 到 body；按 placement 加类供 CSS 翻转强调小条方向 -->
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
  z-index: 50;
  transition: transform 0.1s ease-out;
  pointer-events: none;
  inset: auto;
  margin-left: 8px; /* 因 floating-ui 默认 -8px 会左移，故以 8px 抵消让 popup 与块左对齐 */
}

/* 因 right/top 时 floating-ui 的 translate 为正值或垂直方向，故不需抵消 -8px */
.block-handle-positioner.placement-right {
  margin-right: 8px;
}
.block-handle-positioner.placement-top {
  margin-left: 0;
  margin-top: 16px;
}

/* 因 floating-ui 在 bottom 时下移 6px，故以负 margin-top 抵消让 popup 顶边紧贴行底（与 top 放置对称） */
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
  scale: 1;
  position: relative;
  z-index: 1;
}

/* 因滚动条出现使文本右缘左移、右侧 popup 会偏移不对称，故按滚动条宽度（--block-handle-hshift）向右推回贴齐块外边缘 */
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

/* 因 hoverState 失效时 ProseKit 会隐藏 popup，为使鼠标在手柄上仍可点击 ADD/拖拽，故强制保持显示 */
.block-handle-popup.popup-keep {
  opacity: 1 !important;
  scale: 1 !important;
  display: inline-flex !important;
  visibility: visible !important;
}

/* 因行部分在画布容器外时 ProseKit overlay 判定 anchor 不可见而置 data-state=closed（popup 隐藏），
   但 hover 已命中（行高亮显示），故 activeHover 时强制显示，位置由 popupShiftPx 贴回可见区 */
.block-handle-popup.forced-open {
  opacity: 1 !important;
  scale: 1 !important;
  display: inline-flex !important;
  visibility: visible !important;
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

/* 因 ProseKit 会注入 44×44 的 ::before 扩大热区、导致点击位置与显示不符，故禁用它让点击区域等于按钮本身 */
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

/* 因 placement-bottom 时强调小条需翻转到高亮下缘，与上方对称 */
.block-handle-line-highlight.placement-bottom {
  box-shadow: inset 0 -2px 0 0 rgba(var(--v-theme-primary), 0.45);
}

/* 因拖拽期间需跨编辑器隐藏所有 popup 与行高亮，故由 body 上的拖拽类全局控制 */
body.block-handle-dragging .block-handle-popup {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
body.block-handle-dragging .block-handle-line-highlight {
  display: none !important;
}
</style>
