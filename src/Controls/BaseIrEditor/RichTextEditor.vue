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
  /* 桌面端负边距：左右各预留空白区，供 block-handle popup 在行左/行右侧显示。
     滚动与裁剪交给内部 .editor-scroll（宽度=文本区，滚动条紧贴文本右侧），
     这里 overflow:visible 让 popup 能进入左右 gutter 而不触发滚动条。 */
  margin-left: -64px;
  margin-right: -80px;
  padding-left: 64px;
  padding-right: 80px;
  width: 100%;
  box-sizing: content-box;
  
  height: 100%;
  overflow: visible;
  transition: border-color 0.15s ease;
  touch-action: auto; /* 确保触摸滚动正常 */
}

/* 真正的滚动容器：宽度与文本区一致（不进入左右 gutter），
   横向/纵向滚动条都紧贴富文本编辑区内部右侧，不因 popup gutter 偏移。 */
.editor-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
}

/* 移动端紧凑模式：移除负边距 */
.editor-wrapper.compact {
  margin-left: 0;
  margin-right: 0;
  margin-top: -44px;
  width: 100%;
  padding: 44px 0 0 0;
  box-sizing: border-box;
  /* 顶部留白：移动端 block-handle popup 显示在行上方，首行上方的 popup
     需要这 44px 空间才不会被 overflow:auto 裁剪/隐藏 */
}

.editor-mount {
  outline: none;
  /* 高度随内容增长（不再固定 100%）：否则内容超出 PM 盒子（滚动到底部）的行
     会被 ProseKit 的 hover 判定为“不在 view.dom 内”，无法弹出 popup */
  min-height: 100%;
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

/* 移动端：popup 显示在行上方（由 block-handle 的 placement='top' 控制定位）。
   移动端手柄稍放大、按钮更大，便于触屏点击/拖拽。
   直接绑定 compact 类（而非媒体查询），保证强制移动端/紧凑模式同样生效。 */
.editor-wrapper.compact :deep(.block-handle-popup) {
  transform: translateY(var(--block-handle-shift, 0px)) scale(1.1);
  transform-origin: center bottom;
}
/* bottom 放置（行下方）：缩放原点改为顶部，向下展开 */
.editor-wrapper.compact :deep(.block-handle-positioner.placement-bottom .block-handle-popup) {
  transform-origin: center top;
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