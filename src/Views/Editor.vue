<template>
  <div>
    <v-btn @click="save">保存</v-btn>
    <v-btn @click="load">加载</v-btn>
    <v-btn data-test="add-rich" @click="addRichText">➕ 添加富文本</v-btn>
    <v-btn data-test="add-code" @click="addCodeBlock">➕ 添加代码块</v-btn>
    <v-btn @click="batchToggleHeading(2)">选中设为二级标题</v-btn>

    <div class="canvas">
      <div
        v-for="item in state.items"
        :key="item.id"
        class="drag-wrapper"
        :class="{ selected: state.selectedIds.has(item.id) }"
        @click="(e) => handleSelect(item.id, e)"
      >
        <VueDraggableResizable
          :x="item.x"
          :y="item.y"
          :w="item.w"
          :h="item.h"
          :min-width="100"
          :min-height="100"
          @dragstop="(x: number, y: number) => { item.x = x; item.y = y }"
          @resizestop="(x: number, y: number, w: number, h: number) => { item.x = x; item.y = y; item.w = w; item.h = h }"
        >
          <div style="height:100%;">
            <component
              style="height:100%; min-height:120px;"
              :is="componentMap[item.component as keyof typeof componentMap]"
              :ref="(el: any) => setComponentRef(item.id, el)"
              v-bind="getComponentProps(item)"
              @update:model-value="(val: string) => updateCode(item.id, val)"
              @update:language="(lang: string) => updateLanguage(item.id, lang)"
            />
          </div>
        </VueDraggableResizable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, nextTick, onMounted } from 'vue'
import VueDraggableResizable from 'vue-draggable-resizable-gorkys'
import 'vue-draggable-resizable-gorkys/style.css'

import RichTextEditor from '../Controls/BaseIrEditor/RichTextEditor.vue'
import EditableCodeBlock from '../Controls/EditorPlugin/EditableCodeBlock.vue'
import { NodeJSON } from '@prosekit/core'

// ---------- 类型定义 ----------
interface RichTextConfig {
  content: NodeJSON | null // 富文本文档 JSON，允许 null
}

interface CodeBlockConfig {
  code: string
  language: string
  minWidth?: string
  minHeight?: string
  maxWidth?: string
  maxHeight?: string
}

type WidgetConfig = RichTextConfig | CodeBlockConfig

interface CanvasItem {
  id: string
  x: number
  y: number
  w: number
  h: number
  component: 'RichTextEditor' | 'EditableCodeBlock'
  config: WidgetConfig
}

// ---------- 组件映射 ----------
const componentMap = {
  RichTextEditor,
  EditableCodeBlock,
}

// ---------- 响应式状态 ----------
const state = reactive({
  items: [] as CanvasItem[],
  selectedIds: new Set<string>(),
})
const componentRefs = ref<Record<string, any>>({})

// ---------- 辅助函数 ----------
const getComponentProps = (item: CanvasItem) => {
  if (item.component === 'RichTextEditor') {
    return {
      doc: (item.config as RichTextConfig).content, // 可为 null
    }
  }
  if (item.component === 'EditableCodeBlock') {
    const cfg = item.config as CodeBlockConfig
    return {
      modelValue: cfg.code,
      language: cfg.language,
      minWidth: cfg.minWidth || '300px',
      minHeight: cfg.minHeight || '200px',
      maxWidth: cfg.maxWidth || '',
      maxHeight: cfg.maxHeight || '',
    }
  }
  return {}
}

const updateCode = (id: string, code: string) => {
  const item = state.items.find((i) => i.id === id)
  if (item && item.component === 'EditableCodeBlock') {
    ;(item.config as CodeBlockConfig).code = code
  }
}

const updateLanguage = (id: string, lang: string) => {
  const item = state.items.find((i) => i.id === id)
  if (item && item.component === 'EditableCodeBlock') {
    ;(item.config as CodeBlockConfig).language = lang
  }
}

const setComponentRef = (id: string, el: any) => {
  if (el) componentRefs.value[id] = el
  else delete componentRefs.value[id]
}

const handleSelect = (id: string, e: MouseEvent) => {
  if (e.ctrlKey) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id)
    else state.selectedIds.add(id)
  } else {
    state.selectedIds = new Set([id])
  }
}

// ---------- 同步与存储 ----------
const syncRichTextContent = () => {
  state.items.forEach((item) => {
    if (item.component === 'RichTextEditor') {
      const inst = componentRefs.value[item.id]
      if (inst && inst.doc) {
        ;(item.config as RichTextConfig).content = inst.doc.toJSON()
      }
    }
  })
}

const generateId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

let nextX = 20
let nextY = 20
const STEP = 30

// ---------- 添加组件 ----------
const addRichText = () => {
  const id = generateId()
  state.items.push({
    id,
    x: nextX,
    y: nextY,
    w: 400,
    h: 300,
    component: 'RichTextEditor',
    config: { content: null }, // 初始为空
  })
  nextX += STEP
  nextY += STEP
  if (nextX > 500) {
    nextX = 20
    nextY += 50
  }
}

const addCodeBlock = () => {
  const id = generateId()
  state.items.push({
    id,
    x: nextX,
    y: nextY,
    w: 400,
    h: 250,
    component: 'EditableCodeBlock',
    config: {
      code: '// 在此编写代码',
      language: 'javascript',
      minWidth: '300px',
      minHeight: '200px',
    },
  })
  nextX += STEP
  nextY += STEP
  if (nextX > 500) {
    nextX = 20
    nextY += 50
  }
}

// ---------- 保存 / 加载 ----------
const save = () => {
  syncRichTextContent()
  localStorage.setItem('canvasData', JSON.stringify(state.items))
}

const load = () => {
  const raw = localStorage.getItem('canvasData')
  if (raw) {
    state.items = JSON.parse(raw)
    nextTick(() => {
      state.items.forEach((item) => {
        if (item.component === 'RichTextEditor') {
          const inst = componentRefs.value[item.id]
          const content = (item.config as RichTextConfig).content
          // 如果 content 为 null，编辑器会自行处理空状态
          if (inst && content) {
            inst.importJSON?.(content)
          }
        }
      })
    })
  }
}

// ---------- 批量操作 ----------
const batchToggleHeading = (level: number) => {
  const ids = Array.from(state.selectedIds)
  ids.forEach((id) => {
    const inst = componentRefs.value[id]
    if (inst && typeof inst.toggleHeading === 'function') {
      inst.toggleHeading(level)
    }
  })
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.canvas {
  position: relative;
  width: 100%;
  height: 800px; /* 可调整画布大小 */
  background: #f5f7fa;
  border: 1px solid #ddd;
}
.drag-wrapper {
  position: absolute;
}
.drag-wrapper.selected .vdr {
  outline: 2px solid #409eff;
}
/* 确保内部组件最小高度，避免空内容缩成点 */
.drag-wrapper .vdr > div {
  min-height: 100px;
}
</style>