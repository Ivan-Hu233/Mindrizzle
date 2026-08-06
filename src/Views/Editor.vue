<template>
  <v-sheet class="editor-wrapper">
    <!-- 工具栏 -->
    <div class="toolbar">
      <v-btn @click="save">保存</v-btn>
      <v-btn @click="load">加载</v-btn>
      <v-btn data-test="add-rich" @click="addRichText">➕ 添加富文本</v-btn>
      <v-btn data-test="add-code" @click="addCodeBlock">➕ 添加代码块</v-btn>
      <v-btn @click="batchToggleHeading(2)">选中设为二级标题</v-btn>
      <v-btn @click="toggleEditMode">
        {{ isEditMode ? '切换到只读' : '切换到编辑' }}
      </v-btn>
    </div>

    <!-- 画布区域 -->
    <div class="canvas-container">
      <div class="canvas" @click="handleCanvasClick" ref="canvasRef">
        <template v-for="item in state.items" :key="item.id">
          <VueDraggableResizable
            :x="item.x"
            :y="item.y"
            :w="item.w"
            :h="item.h"
            :min-width="100"
            :min-height="100"
            :is-conflict-check="!isMobile"
            :snap="true"
            :snap-tolerance="10"
            parent
            :active-on-top="true"
            :axis="isMobile ? 'y' : 'both'"
            :handles="isMobile ? ['tm', 'bm'] : undefined"
            @dragstop="(x, y) => { item.x = x; item.y = y }"
            drag-handle=".drag-handle"
            @resizestop="(x, y, w, h) => { item.x = x; item.y = y; item.w = w; item.h = h }"
            :disabled="!isEditMode"
            class="drag-wrapper"
            :class="{ selected: isEditMode && state.selectedIds.has(item.id) }"
          >
            <div class="block-container bg-white elevation-1 rounded">
              <!-- 左上角：名称 + 图标（可拖拽手柄） -->
              <v-sheet v-if="isEditMode"
                       class="drag-handle left-handle border border-grey-lighten-2 border-b-0"
                       color="grey-lighten-4" rounded="t"
                       style="position:absolute; top:-28px; left:10px; height:28px; padding:0 10px; display:flex; align-items:center; cursor:grab; z-index:10; white-space:nowrap;"
                       @mousedown="(e: MouseEvent) => handleSelect(item.id, e)">
                <v-icon size="16" color="grey-darken-2" :icon="mdiDragVertical" class="mr-1" />
                <span class="handle-label text-caption text-grey-darken-2 user-select-none">
                  {{ item.component === 'RichTextEditor' ? '富文本' : '代码块' }}
                </span>
              </v-sheet>

              <!-- 右上角：选中指示器 -->
              <transition name="pop-up">
                <v-sheet v-if="isEditMode && state.selectedIds.has(item.id)"
                         class="drag-handle right-handle border border-grey-lighten-2 border-b-0"
                         color="grey-lighten-4" rounded="t"
                         style="position:absolute; top:-28px; right:10px; height:28px; width:28px; display:flex; align-items:center; justify-content:center; cursor:grab; z-index:10;"
                         @mousedown="(e: MouseEvent) => handleSelect(item.id, e)">
                  <v-avatar size="12" :style="{ backgroundColor: String(primaryColor) }" />
                </v-sheet>
              </transition>

              <!-- 内容区域 -->
              <div class="content-area">
                <component
                  :is="componentMap[item.component as keyof typeof componentMap]"
                  :ref="(el) => setComponentRef(item.id, el)"
                  v-bind="getComponentProps(item)"
                  @update:model-value="(val: string) => updateCode(item.id, val)"
                  @update:language="(lang: string) => updateLanguage(item.id, lang)"
                  class="inner-component"
                />
              </div>
            </div>
          </VueDraggableResizable>
        </template>
      </div>
    </div>
  </v-sheet>
</template>

<script setup lang="ts">
import { reactive, ref, nextTick, onMounted, onUnmounted, computed, watch } from 'vue'
import VueDraggableResizable from 'vue-draggable-resizable-gorkys'
import 'vue-draggable-resizable-gorkys/style.css'

import { mdiDragVertical } from '@mdi/js'
import RichTextEditor from '../Controls/BaseIrEditor/RichTextEditor.vue'
import EditableCodeBlock from '../Controls/EditorPlugin/EditableCodeBlock.vue'
import { NodeJSON } from '@prosekit/core'

import { useTheme, useDisplay } from 'vuetify'

const theme = useTheme()
const primaryColor = computed(() => theme.current.value.colors.primary)

// ---------- 响应式断点 ----------
const { xs } = useDisplay()
const isMobile = computed(() => xs.value)

// ---------- 编辑模式 ----------
const isEditMode = ref(true)
const toggleEditMode = () => {
  isEditMode.value = !isEditMode.value
}

// ---------- 类型定义 ----------
interface RichTextConfig {
  content: NodeJSON | null
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
const canvasRef = ref<HTMLElement | null>(null)
const canvasWidth = ref(0)

// ---------- 移动端边距常量 ----------
const MOBILE_MARGIN = 8 // 左右对称边距

// ---------- 辅助函数 ----------
const getComponentProps = (item: CanvasItem) => {
  if (item.component === 'RichTextEditor') {
    return {
      doc: (item.config as RichTextConfig).content,
      compact: isMobile.value, // 关键
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
    ; (item.config as CodeBlockConfig).code = code
  }
}

const updateLanguage = (id: string, lang: string) => {
  const item = state.items.find((i) => i.id === id)
  if (item && item.component === 'EditableCodeBlock') {
    ; (item.config as CodeBlockConfig).language = lang
  }
}

const setComponentRef = (id: string, el: any) => {
  if (el) componentRefs.value[id] = el
  else delete componentRefs.value[id]
}

const handleSelect = (id: string, e: MouseEvent) => {
  if (e.ctrlKey) {
    const newSet = new Set(state.selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    state.selectedIds = newSet
  } else {
    state.selectedIds = new Set([id])
  }
}

const handleCanvasClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.closest('.drag-wrapper')) return
  state.selectedIds = new Set()
}

// ---------- 同步与存储 ----------
const syncRichTextContent = () => {
  state.items.forEach((item) => {
    if (item.component === 'RichTextEditor') {
      const inst = componentRefs.value[item.id]
      if (inst && inst.doc) {
        ; (item.config as RichTextConfig).content = inst.doc.toJSON()
      }
    }
  })
}

const generateId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

let nextX = 20
let nextY = 20
const STEP = 30

// ---------- 移动端布局适配 ----------
const updateCanvasWidth = () => {
  if (canvasRef.value) {
    canvasWidth.value = canvasRef.value.clientWidth
  }
}

const applyMobileLayout = () => {
  if (isMobile.value && canvasWidth.value > 0) {
    const margin = MOBILE_MARGIN
    state.items.forEach(item => {
      item.x = margin
      item.w = canvasWidth.value - 2 * margin
    })
  }
}

// 监听移动端状态变化，切换布局
watch(isMobile, (newVal) => {
  if (newVal) {
    nextTick(() => {
      updateCanvasWidth()
      applyMobileLayout()
    })
  }
})

// 窗口 resize 时更新宽度并重新布局（若在移动端）
const onResize = () => {
  updateCanvasWidth()
  if (isMobile.value) {
    applyMobileLayout()
  }
}

// ---------- 添加组件 ----------
const addRichText = () => {
  const id = generateId()
  const newItem: CanvasItem = {
    id,
    x: nextX,
    y: nextY,
    w: 400,
    h: 300,
    component: 'RichTextEditor',
    config: { content: null },
  }
  state.items.push(newItem)
  if (isMobile.value && canvasWidth.value > 0) {
    const margin = MOBILE_MARGIN
    newItem.x = margin
    newItem.w = canvasWidth.value - 2 * margin
  }
  nextX += STEP
  nextY += STEP
  if (nextX > 500) {
    nextX = 20
    nextY += 50
  }
}

const addCodeBlock = () => {
  const id = generateId()
  const newItem: CanvasItem = {
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
  }
  state.items.push(newItem)
  if (isMobile.value && canvasWidth.value > 0) {
    const margin = MOBILE_MARGIN
    newItem.x = margin
    newItem.w = canvasWidth.value - 2 * margin
  }
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
      if (isMobile.value) {
        updateCanvasWidth()
        applyMobileLayout()
      }
      state.items.forEach((item) => {
        if (item.component === 'RichTextEditor') {
          const inst = componentRefs.value[item.id]
          const content = (item.config as RichTextConfig).content
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

// ---------- 生命周期 ----------
onMounted(() => {
  load()
  nextTick(() => {
    updateCanvasWidth()
    if (isMobile.value) {
      applyMobileLayout()
    }
  })
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
/* 样式未作改动，保持原样 */
.editor-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
}

.toolbar {
  flex-shrink: 0;
  padding: 8px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
}

.canvas-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 20px 0;
  overflow: hidden;
}

.canvas {
  position: relative;
  width: 90%;
  max-width: 1200px;
  height: 100%;
  min-height: 400px;
  background: transparent;
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: visible;
  box-sizing: border-box;
}

.drag-wrapper.selected {
  outline: 2px solid var(--v-theme-primary);
  outline-offset: -1px;
}

.block-container {
  height: 100%;
  width: 100%;
  position: relative;
  overflow: visible;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.drag-handle {
  position: absolute;
  height: 28px;
  display: flex;
  align-items: center;
  cursor: grab;
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  z-index: 10;
  padding: 0 10px;
  white-space: nowrap;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.2s;
}
.drag-handle:hover {
  background: #eaeaea;
}

.left-handle {
  bottom: 100%;
  left: 10px;
  transform: translateY(-1px);
}

.right-handle {
  bottom: 100%;
  right: 10px;
  transform: translateY(-1px);
  width: 28px;
  justify-content: center;
  padding: 0;
}

.right-handle .selected-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: var(--v-theme-primary);
}

.handle-label {
  font-size: 12px;
  color: #666;
  margin-left: 4px;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 4px;
  box-sizing: border-box;
  background-color: transparent;
}

.inner-component {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
}

.pop-up-enter-active,
.pop-up-leave-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.pop-up-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.6);
}
.pop-up-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.pop-up-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.pop-up-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.6);
}
</style>