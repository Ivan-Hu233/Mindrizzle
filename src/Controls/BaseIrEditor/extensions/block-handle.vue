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
}

@media (prefers-reduced-motion: reduce) {
  .block-handle-positioner {
    transition: none;
  }
}

.block-handle-popup {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 3px;
  margin-right: 4px;
  display: flex;
  pointer-events: auto;
  box-sizing: border-box;
  transition: opacity 0.1s, scale 0.1s;
  transform-origin: var(--transform-origin, center);
  opacity: 1;
  scale: 1;
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

/* 入场动画 (Chrome 117+) */
@starting-style {
  .block-handle-popup[data-state='open'] {
    opacity: 0;
    scale: 0.95;
  }
}

.block-handle-btn {
  position: relative;
  z-index: 1;
  height: 24px;
  width: 24px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 3px;
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.block-handle-btn:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
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
