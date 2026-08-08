<script setup lang="ts">
// block-handle 组件：只负责组装各 composable 与模板/样式。
// 状态拆分见 ./useHoverState.ts（hover）、./useHoverUi.ts（高亮/popup）、./useBlockDrag.ts（拖拽）。
import { mdiPlus, mdiDragVerticalVariant } from '@mdi/js'
import {
  BlockHandleAdd,
  BlockHandleDraggable,
  BlockHandlePopup,
  BlockHandlePositioner,
  BlockHandleRoot,
} from 'prosekit/vue/block-handle'
import type { Editor } from '@prosekit/core'
import { createStoreResolver } from './blockHandleUtils'
import { useHoverState } from './useHoverState'
import { useHoverUi } from './useHoverUi'
import { useBlockDrag } from './useBlockDrag'

interface Props {
  dir?: 'ltr' | 'rtl'
  editor?: Editor | null
}
const props = defineProps<Props>()

// 按实例解析 ProseKit 的 BlockHandleStore（每个编辑器独立，闭包缓存），各 composable 共享
const getStore = createStoreResolver()

// 按依赖顺序组装：hover 状态（拖拽源）→ hover UI（高亮/popup，提供 suppressUI）→ 拖拽
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
</script>

<template>
  <BlockHandleRoot @state-change="onBlockStateChange">
    <BlockHandlePositioner
      :placement="handlePlacement"
      :class="['block-handle-positioner', `placement-${handlePlacement}`]"
      :style="{ '--block-handle-shift': popupShiftPx + 'px', '--block-handle-hshift': popupHShiftPx + 'px' }"
    >
      <BlockHandlePopup
        class="block-handle-popup"
        :class="{ 'popup-keep': popupKeep }"
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

  <!-- 移动端行高亮：teleport 到 body，避免被 .vdr transform / overflow 裁剪。
       按 placement 加类，供 CSS 把高亮上缘的强调小条翻转到 popup 所在侧（反转）。 -->
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
  margin-left: 8px; /* 抵消 floating-ui 的 -8px，让 popup 与块左对齐 */
}

/* right / top 放置时不需要抵消 -8px（floating-ui 的 translate 为正值或垂直方向） */
.block-handle-positioner.placement-right {
  margin-right: 8px;
}
.block-handle-positioner.placement-top {
  margin-left: 0;
  margin-top: 16px;
}

/* bottom 放置：块在 popup 上方，改为上方留白（水平居中）。
   用负 margin-top 抵消 floating-ui 的 6px offset，让 popup 顶边紧贴行底（与 top 放置对称）。 */
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

/* right 放置：块在 popup 左侧，改为左侧留白。
   水平补偿 --block-handle-hshift：滚动条出现时文本右缘左移，会让右侧 popup 偏移、
   与左侧不对称；这里按滚动条宽度把 popup 向右推回，保持贴齐块外边缘。 */
.block-handle-positioner.placement-right .block-handle-popup {
  margin-right: 0;
  margin-left: -6px;
  transform: translateX(var(--block-handle-hshift, 0px));
}

/* top 放置：块在 popup 下方，仅下方留白（水平居中） */
.block-handle-positioner.placement-top .block-handle-popup {
  margin-right: 0;
  margin-bottom: 12px;
  border-bottom-left-radius: 0px;
  border-bottom-right-radius: 0px;
}

/* bottom 放置：块在 popup 上方，仅上方留白（水平居中） */
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

/* 鼠标在 popup 上时强制保持显示：即使 hoverState 已失效（data-state=closed）
   导致 ProseKit 要隐藏 popup，也保持可见可交互，方便点击 ADD 或拖拽手柄。 */
.block-handle-popup.popup-keep {
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

/* ProseKit 会给按钮注入 44×44 的 ::before 扩大热区，导致点击位置与显示不符，
   这里禁用它，让点击区域严格等于按钮本身。 */
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

/* popup 在行下方时（placement-bottom）：强调小条翻转到高亮下缘（反转），
   与 popup 在行上方时小条在上缘形成对称 */
.block-handle-line-highlight.placement-bottom {
  box-shadow: inset 0 -2px 0 0 rgba(var(--v-theme-primary), 0.45);
}

/* 拖拽进行中：全局隐藏所有 block-handle popup 与行高亮（body 类由拖拽开始/结束控制） */
body.block-handle-dragging .block-handle-popup {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
body.block-handle-dragging .block-handle-line-highlight {
  display: none !important;
}
</style>
