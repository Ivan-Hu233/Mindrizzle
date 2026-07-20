<template>
  <div
    class="editor-wrapper"
    :style="{
      color: 'var(--v-theme-on-surface)',
      background: 'var(--v-theme-surface)',
      borderColor: 'var(--v-theme-outline)',
    }"
  >
    <ProseKit :editor="editor">
      <div ref="editorMount" class="editor-mount" />
    </ProseKit>
  </div>
</template>

<script setup lang="ts">
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
  editor.commands.insertNode({
    type: 'vueComponent',
    attrs: { componentName, props },
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
  border: 1px solid;
  border-radius: 6px;
  padding: 12px;
  min-height: 200px;
}
.editor-mount {
  min-height: 180px;
}
.editor-wrapper :deep(.ProseMirror) {
  outline: none;
  min-height: 180px;
  font-size: 1rem;
}
.editor-wrapper :deep(.ProseMirror p) {
  margin: 0;
}
</style>