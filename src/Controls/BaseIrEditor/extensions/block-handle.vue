<script setup lang="ts">
import { mdiPlus, mdiDragVerticalVariant } from '@mdi/js'
import {
  BlockHandleAdd,
  BlockHandleDraggable,
  BlockHandlePopup,
  BlockHandlePositioner,
  BlockHandleRoot,
} from 'prosekit/vue/block-handle'

interface Props {
  dir?: 'ltr' | 'rtl'
}

const props = defineProps<Props>()
</script>

<template>
  <BlockHandleRoot>
    <BlockHandlePositioner
      :placement="props.dir === 'rtl' ? 'right' : 'left'"
      class="block-handle-positioner"
    ><!--TODO 未来或许可以把这个单独分离出来成为一个窗口?-->
      <BlockHandlePopup class="block-handle-popup">
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
          @dragstart.stop
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
  /* ProseKit 用 floating-ui 注入 transform: translate(-8px, 1px)，
     把手柄定位到块左侧。但定位容器 .inner-component 有 overflow:auto，
     popup 左端会因 -8px 溢出容器左边界而被裁剪（显示不全）。
     这里用 margin-left 精确抵消 -8px，让 popup 完整显示在容器内。 */
  margin-left: 8px;
}

@media (prefers-reduced-motion: reduce) {
  .block-handle-positioner {
    transition: none;
  }
}

.block-handle-popup {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
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

/* ProseKit 会给按钮注入一个 44×44 的 ::before 来扩大热区，
   这会让点击位置与显示的按钮不符，且两个按钮的热区互相重叠，
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
</style>
