<template>
  <div
    class="editor-wrapper"
    :style="{
      color: 'var(--v-theme-on-surface)',
      background: 'var(--v-theme-surface)',
    }"
  >
    <ProseKit :editor="editor">
      <div ref="editorMount" class="editor-mount" />
      <blockHandle />
      <dropIndicator />
    </ProseKit>
  </div>
</template>

<script setup lang="ts">
import 'prosekit/basic/style.css'
import 'prosekit/basic/typography.css'
import 'prosekit/pm/view/style/prosemirror.css'

import blockHandle from './extensions/block-handle.vue'
import dropIndicator from './extensions/drop-indicator.vue'
import { ref, onMounted, onUnmounted } from 'vue'
import { ProseKit } from '@prosekit/vue'

import { defineExtension } from './extension.ts'
import { createEditor, NodeJSON } from '@prosekit/core'

const extension = defineExtension()
const editor = createEditor({ extension })
const editorMount = ref<HTMLDivElement>()

onMounted(() => {
  if (editorMount.value) {
    editor.mount(editorMount.value)
  }
})

onUnmounted(() => {
  editor.unmount()
})

function insertVueComponent(componentName: string, props: Record<string, any> = {}) {
  const view = editor.view
  if (!view) return

  // 直接使用 view.dom 的宽度（即 ProseMirror 内容区宽度）
  const containerWidth = view.dom.clientWidth || 360
  const defaultWidth = Math.min(360, containerWidth)
  const defaultHeight = 240

  editor.commands.insertNode({
    type: 'vueComponent',
    attrs: { componentName, props, width: defaultWidth, height: defaultHeight },
  })
}

function toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  // 如果当前已经是该级别标题，则切换回段落；否则设置为该级别标题
  const { state } = editor
  const { selection } = state
  const node = selection.$from.node(selection.$from.depth)
  if (node && node.type.name === 'heading' && node.attrs.level === level) {
    editor.commands.setParagraph()
  } else {
    editor.commands.setHeading({ level })
  }
}

function insertMathInline(latex: string) {
  const { view } = editor
  const { state } = view
  const node = state.schema.nodes.mathInline?.create({}, state.schema.text(latex))
  if (!node) return
  const tr = state.tr.replaceSelectionWith(node)
  view.dispatch(tr)
  view.focus()
}

function insertMathBlock(latex: string) {
  const { view } = editor
  const { state } = view
  const node = state.schema.nodes.mathBlock?.create({}, state.schema.text(latex))
  if (!node) return
  const tr = state.tr.replaceSelectionWith(node)
  view.dispatch(tr)
  view.focus()
}

function importJSON(json: NodeJSON) {
  editor.setContent(json)
}

defineExpose({
  commands: editor.commands,
  doc: editor.state.doc,
  insertVueComponent,
  toggleHeading,
  insertMathInline,
  insertMathBlock,
  importJSON,
})
</script>

<style scoped>
.editor-wrapper {
  position: relative;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0;
  
  /* ===== 关键修改：向左延伸 56px ===== */
  margin-left: -56px;          /* 整体左移 56px */
  width: calc(100% + 56px);   /* 宽度相应增加，防止右侧被拉短 */
  padding-left: 56px;         /* 把内容（ProseMirror）向右推回原位 */
  box-sizing: border-box;     /* 确保 padding 计入宽高内 */
  
  height: 100%;
  overflow: auto;             /* 解决之前你遇到的多行文字溢出问题 */
  min-height: 120px;
  transition: border-color 0.15s ease;
}

.editor-mount:focus-within {
  border-color: rgb(var(--v-theme-primary));
}

.editor-mount {
  min-height: 100%;       /* 确保内部占满，但ProseMirror会自动撑开，可保留 */
  outline: none;
}

.editor-mount :deep(.ProseMirror) {
  padding: 0;
  min-height: 120px;      /* 与wrapper的最小高度匹配 */
  outline: none;
}
</style>