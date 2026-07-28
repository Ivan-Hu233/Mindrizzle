<template>
  <v-sheet>
    <v-btn @click="save">保存</v-btn>
    <v-btn @click="load">加载</v-btn>
    <v-btn data-test="add-rich" @click="addRichText">➕ 添加富文本</v-btn>
    <v-btn data-test="add-code" @click="addCodeBlock">➕ 添加代码块</v-btn>
    <v-btn @click="batchToggleHeading(2)">选中设为二级标题</v-btn>
    <v-btn @click="toggleEditMode">
      {{ isEditMode ? '切换到只读' : '切换到编辑' }}
    </v-btn>

    <div class="canvas">
      <template v-for="item in state.items" :key="item.id" class="drag-wrapper"
        :class="{ selected: isEditMode && state.selectedIds.has(item.id) }">
        <VueDraggableResizable :x="item.x" :y="item.y" :w="item.w" :h="item.h" :min-width="100" :min-height="100"
          :is-conflict-check="true" :snap="true" :snap-tolerance="10" parent=".canvas" :active-on-top="true"
          @dragstop="(x, y) => { item.x = x; item.y = y }" drag-handle=".drag-handle"
          @resizestop="(x, y, w, h) => { item.x = x; item.y = y; item.w = w; item.h = h }" :disabled="!isEditMode">
          <div class="block-container"
            style="height:100%; width:100%; position:relative; overflow:visible; background: #fff; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">

            <!-- 左上角：名称 + 图标 -->
            <div v-if="isEditMode" class="drag-handle" @mousedown="(e) => handleSelect(item.id, e)"
              style="position:absolute; top:-28px; left:10px; height:28px; padding:0 10px; display:flex; align-items:center; cursor:grab; background:#f5f5f5; border-radius:4px 4px 0 0; border:1px solid #e0e0e0; border-bottom:0; z-index:10; white-space:nowrap;">
              <v-icon size="16" color="grey-darken-2" :icon="mdiDragVertical" />
              <span style="font-size:12px; color:#666; user-select:none; margin-left:4px;">
                {{ item.component === 'RichTextEditor' ? '富文本' : '代码块' }}
              </span>
            </div>

            <!-- 右上角：选中指示器 -->
            <transition name="pop-up">
              <div v-if="isEditMode && state.selectedIds.has(item.id)" class="drag-handle"
                @mousedown="(e) => handleSelect(item.id, e)"
                style="position:absolute; top:-28px; right:10px; height:28px; width:28px; display:flex; align-items:center; justify-content:center; cursor:grab; background:#f5f5f5; border-radius:4px 4px 0 0; border:1px solid #e0e0e0; border-bottom:0; z-index:10;">
                <div style="width:12px; height:12px; border-radius:50%;"
                  :style="{ backgroundColor: String(primaryColor) }"></div>
              </div>
            </transition>

            <!-- 内容区域 -->
            <div style="background-color: transparent; height:100%; width:100%; padding:4px; box-sizing:border-box;">
              <component style="height:100%;" :is="componentMap[item.component as keyof typeof componentMap]"
                :ref="(el) => setComponentRef(item.id, el)" v-bind="getComponentProps(item)"
                @update:model-value="(val: string) => updateCode(item.id, val)"
                @update:language="(lang: string) => updateLanguage(item.id, lang)" />
            </div>
          </div>
        </VueDraggableResizable>
      </template>
    </div>
  </v-sheet>
</template>

<script setup lang="ts">
import { reactive, ref, nextTick, onMounted, computed } from 'vue'
import VueDraggableResizable from 'vue-draggable-resizable-gorkys'
import 'vue-draggable-resizable-gorkys/style.css'

import { mdiDragVertical } from '@mdi/js'
import RichTextEditor from '../Controls/BaseIrEditor/RichTextEditor.vue'
import EditableCodeBlock from '../Controls/EditorPlugin/EditableCodeBlock.vue'
import { NodeJSON } from '@prosekit/core'

import { useTheme } from 'vuetify'
const theme = useTheme()
const primaryColor = computed(() => theme.current.value.colors.primary)

const isEditMode = ref(true);
const toggleEditMode = () => {
  isEditMode.value = !isEditMode.value
}

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
    // 创建新 Set 并基于当前选中切换
    const newSet = new Set(state.selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    state.selectedIds = newSet;  // 重新赋值触发更新
  } else {
    state.selectedIds = new Set([id]);  // 直接替换
  }
}

// 处理画布空白点击取消选中
const handleCanvasClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  // 如果点击的元素或其父级包含 .drag-wrapper，则忽略（因为内部点击已由 handleSelect 处理）
  if (target.closest('.drag-wrapper')) return;
  state.selectedIds = new Set();  // 清空选中
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
const save = () => {//TODO rust后端保存数据
  syncRichTextContent()
  localStorage.setItem('canvasData', JSON.stringify(state.items))
}

const load = () => {//TODO rust后端保存数据
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
  width: calc(100% - 112px);
  height: 100%;
  /* width: 1000px;
  height: 800px; */
  background: transparent;
  border: 1px solid #ddd;
  left: 56px;
  overflow: visible !important;
  /* 允许手柄溢出 */
}

.drag-wrapper {
  position: absolute;
}

.drag-wrapper.selected .vdr {
  outline: 2px solid var(--v-theme-primary);
}

/* 动画 */
/* 右上角指示器整体弹出动画 */
.pop-up-enter-active,/* TODO 更改动画，更有机械感 */
.pop-up-leave-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); /* 弹性缓动 */
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