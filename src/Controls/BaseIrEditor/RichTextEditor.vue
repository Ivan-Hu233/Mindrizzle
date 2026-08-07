<template>
  <div
    class="editor-wrapper"
    :class="{ compact: useCompact }"
    :style="{
      color: 'var(--v-theme-on-surface)',
      background: 'var(--v-theme-surface)',
    }"
    @mousedown.stop
    @touchstart.stop
  >
    <ProseKit :editor="editor">
      <div ref="editorMount" class="editor-mount" />
      <blockHandle :editor="editor" />
      <!-- teleport 到 body，避免 .vdr 的 transform 祖先让 position:fixed 定位基准偏移 -->
      <Teleport to="body">
        <RowDropIndicator :editor="editor" />
      </Teleport>
    </ProseKit>
  </div>
</template>
<script lang="ts">
import type { ResizeConstraints } from '../resizeConstraints'

export const resizeConstraints: ResizeConstraints = {
  minWidth: 250,
  maxWidth: null,
  minHeight: 160,
  maxHeight: null,
}
</script>
<script setup lang="ts">
import 'prosekit/basic/style.css'
import 'prosekit/basic/typography.css'
import 'prosekit/pm/view/style/prosemirror.css'

import blockHandle from './extensions/block-handle.vue'
import RowDropIndicator from './extensions/RowDropIndicator.vue'
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ProseKit } from '@prosekit/vue'
import { useDisplay } from 'vuetify'

import { defineExtension } from './extension.ts'
import { createEditor, NodeJSON } from '@prosekit/core'

interface Props {
  dir?: 'ltr' | 'rtl'
  compact?: boolean
  doc?: NodeJSON | null
}
const props = defineProps<Props>()

const { xs } = useDisplay()
const isMobile = computed(() => xs.value)
const useCompact = computed(() => props.compact ?? isMobile.value)

const extension = defineExtension()
const editor = createEditor({ extension })
const editorMount = ref<HTMLDivElement>()

onMounted(() => {
  if (editorMount.value) {
    editor.mount(editorMount.value)
    // 移动端主动聚焦（可选）
    if (isMobile.value) {
      setTimeout(() => editor.view?.focus(), 100)
    }
    // 如果外部传入了初始 doc，导入到编辑器
    if (props.doc) {
      editor.setContent(props.doc)
    }
  }
})

onUnmounted(() => {
  editor.unmount()
})

function importJSON(json: NodeJSON) {
  editor.setContent(json)
}

// 监听外部 doc prop 的变化并导入
watch(() => props.doc, (v) => {
  if (v) editor.setContent(v as NodeJSON)
})

defineExpose({
  commands: editor.commands,
  doc: editor.state.doc,
  importJSON,
  getDocJSON() {
    return editor.state.doc.toJSON()
  },
  // 组件自有的保存 / 加载方法：父组件统一调用，不再按组件类型特殊处理
  saveConfig() {
    return { content: editor.state.doc.toJSON() }
  },
  loadConfig(config: { content?: NodeJSON | null }) {
    if (config?.content) editor.setContent(config.content as NodeJSON)
  },
})
</script>

<style scoped>
.editor-wrapper {
  position: relative;
  border: 1px solid transparent;
  border-radius: 4px;
  margin: 0px;
  /* 桌面端负边距，为手柄留空间 */
  margin-left: -64px;
  padding-left: 64px;
  width: 100%;
  box-sizing: content-box;
  
  height: 100%;
  overflow: auto;
  transition: border-color 0.15s ease;
  touch-action: auto; /* 确保触摸滚动正常 */
}

/* 移动端紧凑模式：移除负边距 */
.editor-wrapper.compact {
  margin-left: 0;
  width: 100%;
  padding-left: 0;
}

.editor-mount {
  outline: none;
  height: 100%;          /* 关键：让挂载点撑满父容器 */
  width: 100%;
  pointer-events: auto;  /* 确保可交互 */
}

.editor-mount:focus-within {
  border-color: rgb(var(--v-theme-primary));
}

.editor-mount :deep(.ProseMirror) {
  padding: 0;
  outline: none;
  height: 100%;          /* 让 ProseMirror 填充整个挂载点 */
  min-height: 100px;     /* 保底高度，确保可点击 */
  pointer-events: auto;
  touch-action: auto;
}

/* 移动端微调块手柄位置（避免被裁剪或遮挡） */
@media (max-width: 600px) {
  .editor-wrapper.compact :deep(.block-handle-positioner) {
    transform: translateX(4px) scale(0.85);
    transform-origin: top left;
    /* 确保手柄在上层但不拦截编辑器点击（默认 pointer-events: auto，但手柄区域很小） */
  }
}
</style>