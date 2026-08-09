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
      <div class="editor-scroll">
        <div ref="editorMount" class="editor-mount" />
      </div>
      <blockHandle :editor="editor" />
      <!-- 因 .vdr 的 transform 祖先会使 fixed 定位基准偏移，故 teleport 到 body -->
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
    if (isMobile.value) {
      setTimeout(() => editor.view?.focus(), 100)
    }
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
  // 因父组件需统一调用保存/加载而不按组件类型特判，故暴露统一的 saveConfig/loadConfig
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
  /* 因需为 block-handle popup 预留左右 gutter 显示区，故用负边距扩展；
     overflow:visible 让 popup 进入 gutter 而不触发滚动条 */
  margin-left: -64px;
  margin-right: -80px;
  padding-left: 64px;
  padding-right: 80px;
  width: 100%;
  box-sizing: content-box;
  
  height: 100%;
  overflow: visible;
  transition: border-color 0.15s ease;
  touch-action: auto; /* 因需保证触摸滚动正常，故设为 auto */
}

/* 因滚动条需紧贴文本区右侧、不被 popup gutter 偏移，故滚动容器宽度与文本区一致（不进 gutter） */
.editor-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
}

.editor-wrapper.compact {
  margin-left: 0;
  margin-right: 0;
  margin-top: -44px;
  width: 100%;
  padding: 44px 0 0 0;
  box-sizing: border-box;
  /* 因移动端首行上方的 popup 需 44px 空间才不被 overflow:auto 裁剪，故顶部留白 */
}

.editor-mount {
  outline: none;
  /* 因固定 100% 高度时底部行会被 ProseKit hover 判定为不在 view.dom 内而无法弹 popup，故高度随内容增长 */
  min-height: 100%;
  width: 100%;
  pointer-events: auto;
}

.editor-mount:focus-within {
  border-color: rgb(var(--v-theme-primary));
}

.editor-mount :deep(.ProseMirror) {
  padding: 0;
  outline: none;
  height: 100%;
  min-height: 100px;
  pointer-events: auto;
  touch-action: auto;
}

/* 因需保证强制移动端/紧凑模式同样生效，故直接绑定 compact 类而非用媒体查询 */
.editor-wrapper.compact :deep(.block-handle-popup) {
  transform: translateY(var(--block-handle-shift, 0px)) scale(1.1);
  transform-origin: center bottom;
}
/* 因 bottom 放置需向下展开，故缩放原点改为顶部 */
.editor-wrapper.compact :deep(.block-handle-positioner.placement-bottom .block-handle-popup) {
  transform-origin: center top;
}

/* 因放大仅针对移动端 compact，故桌面端 top/bottom 退化时保持正常大小、仅应用垂直裁剪补偿 */
.editor-wrapper:not(.compact) :deep(.block-handle-positioner.placement-top .block-handle-popup),
.editor-wrapper:not(.compact) :deep(.block-handle-positioner.placement-bottom .block-handle-popup) {
  transform: translateY(var(--block-handle-shift, 0px));
}
.editor-wrapper.compact :deep(.block-handle-btn) {
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
}
.editor-wrapper.compact :deep(.block-handle-btn svg) {
  width: 22px;
  height: 22px;
}
</style>