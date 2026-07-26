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

import blockHandle from './extensions/block-handle.vue'
import dropIndicator from './extensions/drop-indicator.vue'
import { ref, onMounted, onUnmounted } from 'vue'
import { ProseKit } from '@prosekit/vue'
import {
  createEditor,
  union,
  defineBaseCommands,
  defineBaseKeymap,
  defineHistory,
} from '@prosekit/core'
import 'prosekit/pm/view/style/prosemirror.css'
import { defineDoc } from '@prosekit/extensions/doc'
import { defineParagraph } from '@prosekit/extensions/paragraph'
import { defineText } from '@prosekit/extensions/text'
import {
  bold,
  italic,
  underline,
  strikethrough,
  textColor,
  backgroundColor,
  highlight,
  fontFamily,
  boldKeymap,
  italicKeymap,
  underlineKeymap,
  strikethroughKeymap,
  highlightKeymap,
} from './extensions/formatting'
import { vueComponentNode, vueComponentNodeView } from './extensions/vue-component'

const editorMount = ref<HTMLDivElement>()

// 创建编辑器实例，传入所有扩展
const editor = createEditor({
  extension: union(
    defineBaseCommands(),
    defineDoc(),
    defineParagraph(),
    defineText(),
    defineBaseKeymap(),
    defineHistory(),
    bold,
    italic,
    underline,
    strikethrough,
    textColor,
    backgroundColor,
    highlight,
    fontFamily,
    // 快捷键
    boldKeymap,
    italicKeymap,
    underlineKeymap,
    strikethroughKeymap,
    highlightKeymap,
    vueComponentNode,
    vueComponentNodeView,
  ),
})

onMounted(() => {
  if (editorMount.value) {
    editor.mount(editorMount.value)
  }
})

onUnmounted(() => {
  editor.unmount()
})

// ---------- 对外暴露的操作方法 ----------
function toggleBold() {
  editor.commands.toggleBold()
}

function toggleItalic() {
  editor.commands.toggleItalic()
}

function toggleUnderline() {
  editor.commands.toggleUnderline()
}

function toggleStrikethrough() {
  editor.commands.toggleStrike()
}

function setTextColor(color: string) {
  editor.commands.addTextColor({ color })
}

function removeTextColor() {
  editor.commands.removeTextColor()
}

function setHighlight(bgColor: string) {
  editor.commands.addBackgroundColor({ color: bgColor })
}

function removeHighlight() {
  editor.commands.removeBackgroundColor()
}

function setFontFamily(family: string) {
  editor.commands.addFontFamily({ family })
}

function removeFontFamily() {
  editor.commands.removeFontFamily()
}

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

defineExpose({
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrikethrough,
  setTextColor,
  removeTextColor,
  setHighlight,
  removeHighlight,
  setFontFamily,
  removeFontFamily,
  insertVueComponent,
})
</script>

<style scoped>
.editor-wrapper {
  position: relative;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0;
  min-height: 200px;
  transition: border-color 0.15s ease;
}

.editor-wrapper:focus-within {
  border-color: rgb(var(--v-theme-primary));
}

.editor-mount {
  padding: 12px 56px 12px 56px;
  min-height: 180px;
  outline: none;
}

.editor-mount :deep(.ProseMirror) {
  padding: 0;
  min-height: 180px;
  outline: none;
}
</style>
