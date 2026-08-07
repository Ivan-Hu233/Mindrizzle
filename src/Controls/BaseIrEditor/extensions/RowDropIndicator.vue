<script setup lang="ts">
import { definePlugin, type Editor } from '@prosekit/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  createRowDropIndicatorPlugin,
  type RowDropShow,
} from './row-drop-indicator'

const props = defineProps<{ editor?: Editor | null }>()

// 当前要显示的指示器线（viewport 坐标），null 表示隐藏。
const line = ref<RowDropShow['line'] | null>(null)
let ext: ReturnType<typeof definePlugin> | null = null

onMounted(() => {
  const editor = props.editor
  if (!editor) return
  ext = definePlugin(
    createRowDropIndicatorPlugin({
      onShow: (show) => {
        line.value = show.line
      },
      onHide: () => {
        line.value = null
      },
    }),
  )
  editor.use(ext)
})

onUnmounted(() => {
  // editor.unmount() 会统一清理所有插件，无需手动 unuse。
  ext = null
})

const indicatorStyle = computed<any>(() => {
  const l = line.value
  if (!l) return { display: 'none' }
  const { p1, p2 } = l
  const horizontal = p1.y === p2.y
  const width = horizontal ? p2.x - p1.x : 2
  const height = horizontal ? 2 : p2.y - p1.y
  const top = horizontal ? p1.y - 1 : p1.y
  const left = horizontal ? p1.x : p1.x - 1
  return {
    position: 'fixed',
    pointerEvents: 'none',
    display: 'block',
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)`,
    left: '0px',
    top: '0px',
  }
})
</script>

<template>
  <div class="block-drop-indicator" :style="indicatorStyle" />
</template>

<style scoped>
.block-drop-indicator {
  background-color: rgba(var(--v-theme-primary), 0.9);
  border-radius: 1px;
}
</style>
