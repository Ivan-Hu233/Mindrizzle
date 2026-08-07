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
      <v-btn @click="toggleMobileSim">
        {{ mobileButtonLabel }}
      </v-btn>
      <v-btn color="error" data-test="delete-selected" @click="deleteSelected" :disabled="state.selectedIds.size === 0">
        删除
      </v-btn>
    </div>

    <RichTextEditor style="margin: 16px;" v-if="false"/>

    <!-- 画布区域 -->
    <div class="canvas-container">
      <div class="canvas" @click="handleCanvasClick" @mousedown="startSelection" @mousemove="updateSelection" ref="canvasRef">
        <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle"></div>
        <template v-for="item in state.items" :key="item.id">
          <VueDraggableResizable
            :x="layoutOf(item).x"
            :y="layoutOf(item).y"
            :w="layoutOf(item).w"
            :h="layoutOf(item).h"
            :min-width="100"
            :min-height="100"
            :is-conflict-check="!mobileMode"
            :snap="true"
            :snap-tolerance="10"
            parent
            :active-on-top="true"
            :axis="mobileMode ? 'y' : 'both'"
            :handles="mobileMode ? ['tm', 'bm'] : undefined"
            @dragging="(x, y) => onDragging(item, x, y)"
            @dragstop="(x, y) => onDragStop(item, x, y)"
            drag-handle=".drag-handle"
            @resizestop="(x, y, w, h) => onResizeStop(item, x, y, w, h)"
            :disabled="!isEditMode"
            class="drag-wrapper"
            :class="{ selected: isEditMode && state.selectedIds.has(item.id) }"
          >
            <div class="block-container bg-white elevation-1 rounded">
              <!-- 左上角：名称 + 图标（可拖拽手柄） -->
              <v-sheet v-if="isEditMode" class="drag-handle border border-grey-lighten-2 border-b-0"
                     color="grey-lighten-4" rounded="t"
                     style="position:absolute; top:-28px; left:10px; height:28px; padding:0 10px; display:flex; align-items:center; cursor:grab; z-index:10; white-space:nowrap;"
                     @mousedown="(e: MouseEvent) => handleSelect(item.id, e)">
              <v-icon size="16" color="grey-darken-2" :icon="mdiDragVariant" class="mr-1" />
              <span class="text-caption text-grey-darken-2 user-select-none">
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
                  <!-- <v-btn icon small color="red" style="margin-left:6px;" @click.stop="deleteItem(item.id)">
                    <v-icon size="14" :icon="mdiDelete" />
                  </v-btn> -->
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

import { mdiDragVariant } from '@mdi/js'
import RichTextEditor from '../Controls/BaseIrEditor/RichTextEditor.vue'
import EditableCodeBlock from '../Controls/EditorPlugin/EditableCodeBlock.vue'
import { NodeJSON } from '@prosekit/core'

import { useTheme, useDisplay } from 'vuetify'

const theme = useTheme()
const primaryColor = computed(() => theme.current.value.colors.primary)

// ---------- 响应式断点 ----------
const { xs } = useDisplay()
const isMobile = computed(() => xs.value)

// ---------- 可控移动端模拟（用于调试/强制切换） ----------
const forceMobile = ref<boolean | null>(null) // null = 不强制，使用真实断点
const mobileMode = computed(() => (forceMobile.value === null ? isMobile.value : forceMobile.value))
const mobileButtonLabel = computed(() => {
  if (forceMobile.value === null) return '模拟移动端'
  return forceMobile.value ? '强制桌面' : '恢复自动布局'
})

const toggleMobileSim = () => {
  // cycle: null -> true -> false -> null
  if (forceMobile.value === null) forceMobile.value = true
  else if (forceMobile.value === true) forceMobile.value = false
  else forceMobile.value = null
  nextTick(() => {
    updateCanvasWidth()
    if (mobileMode.value) applyMobileLayout()
  })
}

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

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface CanvasItem {
  id: string
  component: 'RichTextEditor' | 'EditableCodeBlock'
  config: WidgetConfig
  layout: {
    desktop: Rect
    mobile: Rect
  }
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
const dragGroupState = ref<{ active: boolean; origins: Record<string, { x: number; y: number }> }>({
  active: false,
  origins: {},
})
const selectionBox = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const selectionState = reactive({
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  extend: false,
  justFinishedSelection: false,
})

const selectionBoxStyle = computed(() => {
  if (!selectionBox.value) return {}
  const { x, y, w, h } = selectionBox.value
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`,
  }
})

// ---------- 移动端边距常量 ----------
const MOBILE_MARGIN = 8 // 左右对称边距

// ---------- 辅助函数 ----------
const getComponentProps = (item: CanvasItem) => {
  if (item.component === 'RichTextEditor') {
    return {
      doc: (item.config as RichTextConfig).content,
      compact: mobileMode.value, // 关键
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

// Layout helpers
const layoutOf = (item: CanvasItem) => (mobileMode.value ? item.layout.mobile : item.layout.desktop)

const syncItemPosition = (item: CanvasItem, x: number, y: number) => {
  item.layout.desktop.x = x
  item.layout.desktop.y = y
  item.layout.mobile.x = x
  item.layout.mobile.y = y
}

const getSelectedItemIds = (item: CanvasItem) => {
  const selected = state.selectedIds.has(item.id) && state.selectedIds.size > 1
    ? Array.from(state.selectedIds)
    : [item.id]
  return selected
}

const onDragging = (item: CanvasItem, x: number, y: number) => {
  if (!dragGroupState.value.active) {
    dragGroupState.value = {
      active: true,
      origins: Object.fromEntries(
        getSelectedItemIds(item).map((id) => {
          const target = state.items.find((it) => it.id === id)
          if (!target) return [id, { x: 0, y: 0 }]
          return [id, { x: target.layout.desktop.x, y: target.layout.desktop.y }]
        }),
      ),
    }
  }

  const targetOrigin = dragGroupState.value.origins[item.id] ?? { x: item.layout.desktop.x, y: item.layout.desktop.y }
  const dx = x - targetOrigin.x
  const dy = y - targetOrigin.y

  getSelectedItemIds(item).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (!target) return
    const origin = dragGroupState.value.origins[id] ?? { x: target.layout.desktop.x, y: target.layout.desktop.y }
    syncItemPosition(target, origin.x + dx, origin.y + dy)
  })
}

const onDragStop = (item: CanvasItem, x: number, y: number) => {
  dragGroupState.value = { active: false, origins: {} }
  syncItemPosition(item, x, y)
}

const onResizeStop = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  // 同步更新两端尺寸与位置
  item.layout.desktop.x = x
  item.layout.desktop.y = y
  item.layout.desktop.w = w
  item.layout.desktop.h = h

  item.layout.mobile.x = x
  item.layout.mobile.y = y
  item.layout.mobile.w = w
  item.layout.mobile.h = h
}

const handleSelect = (id: string, e: MouseEvent) => {
  const isSelected = state.selectedIds.has(id)
  const selectedCount = state.selectedIds.size

  if (e.ctrlKey) {
    const newSet = new Set(state.selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    state.selectedIds = newSet
  } else if (isSelected && selectedCount > 1) {
    // 保留当前多选集合，避免拖拽手柄时把它收缩为单选
    return
  } else {
    state.selectedIds = new Set([id])
  }
}

const updateSelectionBox = () => {
  const x = Math.min(selectionState.startX, selectionState.currentX)
  const y = Math.min(selectionState.startY, selectionState.currentY)
  const w = Math.abs(selectionState.currentX - selectionState.startX)
  const h = Math.abs(selectionState.currentY - selectionState.startY)
  selectionBox.value = w > 2 || h > 2 ? { x, y, w, h } : null
}

const isRectIntersectingItem = (rect: { x: number; y: number; w: number; h: number }, item: CanvasItem) => {
  const itemRect = layoutOf(item)
  return itemRect.x < rect.x + rect.w && itemRect.x + itemRect.w > rect.x && itemRect.y < rect.y + rect.h && itemRect.y + itemRect.h > rect.y
}

const startSelection = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (e.button !== 0) return
  if (target.closest('.drag-wrapper') || target.closest('.drag-handle') || target.closest('.toolbar')) return

  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  e.preventDefault()
  selectionState.active = true
  selectionState.extend = e.ctrlKey
  selectionState.justFinishedSelection = false
  selectionState.startX = e.clientX - rect.left
  selectionState.startY = e.clientY - rect.top
  selectionState.currentX = selectionState.startX
  selectionState.currentY = selectionState.startY
  updateSelectionBox()
}

const updateSelection = (e: MouseEvent) => {
  if (!selectionState.active) return
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  e.preventDefault()
  selectionState.currentX = e.clientX - rect.left
  selectionState.currentY = e.clientY - rect.top
  updateSelectionBox()
}

const finishSelection = () => {
  if (!selectionState.active) return
  selectionState.active = false
  const rect = selectionBox.value
  if (rect) {
    const matchedIds = state.items.filter((item) => isRectIntersectingItem(rect, item)).map((item) => item.id)
    if (selectionState.extend) {
      const next = new Set(state.selectedIds)
      matchedIds.forEach((id) => next.add(id))
      state.selectedIds = next
    } else {
      state.selectedIds = new Set(matchedIds)
    }
  } else if (!selectionState.extend) {
    state.selectedIds = new Set()
  }
  selectionState.justFinishedSelection = true
  selectionBox.value = null
}

const handleCanvasClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (selectionState.justFinishedSelection) {
    selectionState.justFinishedSelection = false
    return
  }
  if (target.closest('.drag-wrapper')) return
  state.selectedIds = new Set()
}

// ---------- 同步与存储 ----------
const syncRichTextContent = () => {
  state.items.forEach((item) => {
    if (item.component === 'RichTextEditor') {
      const inst = componentRefs.value[item.id]
      if (inst) {
        if (typeof inst.getDocJSON === 'function') {
          ; (item.config as RichTextConfig).content = inst.getDocJSON()
        } else if (inst.doc && typeof inst.doc.toJSON === 'function') {
          ; (item.config as RichTextConfig).content = inst.doc.toJSON()
        }
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
  if (mobileMode.value && canvasWidth.value > 0) {
    const margin = MOBILE_MARGIN
    state.items.forEach(item => {
      item.layout.mobile.x = margin
      item.layout.mobile.w = canvasWidth.value - 2 * margin
    })
  }
}

// 监听移动端状态变化，切换布局
watch(mobileMode, (newVal) => {
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
  if (mobileMode.value) {
    applyMobileLayout()
  }
}

// ---------- 添加组件 ----------
const addRichText = () => {
  const id = generateId()
  const newItem: CanvasItem = {
    id,
    component: 'RichTextEditor',
    config: { content: null },
    layout: {
      desktop: { x: nextX, y: nextY, w: 400, h: 300 },
      mobile: { x: nextX, y: nextY, w: 400, h: 300 },
    },
  }
  state.items.push(newItem)
  if (mobileMode.value && canvasWidth.value > 0) {
    const margin = MOBILE_MARGIN
    newItem.layout.mobile.x = margin
    newItem.layout.mobile.w = canvasWidth.value - 2 * margin
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
    component: 'EditableCodeBlock',
    config: {
      code: '// 在此编写代码',
      language: 'javascript',
      minWidth: '300px',
      minHeight: '200px',
    },
    layout: {
      desktop: { x: nextX, y: nextY, w: 400, h: 250 },
      mobile: { x: nextX, y: nextY, w: 400, h: 250 },
    },
  }
  state.items.push(newItem)
  if (mobileMode.value && canvasWidth.value > 0) {
    const margin = MOBILE_MARGIN
    newItem.layout.mobile.x = margin
    newItem.layout.mobile.w = canvasWidth.value - 2 * margin
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
  // 保存时不持久化 mobile 的宽高（让移动端宽度在运行时根据画布宽度计算）
  const serializable = state.items.map((it) => ({
    id: it.id,
    component: it.component,
    config: it.config,
    layout: {
      desktop: { ...it.layout.desktop },
      // 仅保存 mobile 的位置，不保存 w/h
      mobile: { x: it.layout.mobile.x, y: it.layout.mobile.y },
    },
  }))
  localStorage.setItem('canvasData', JSON.stringify(serializable))
}

const load = async () => {
  const raw = localStorage.getItem('canvasData')
  if (raw) {
    const parsed = JSON.parse(raw)
    // 兼容旧数据结构：如果没有 layout 字段，则将顶层 x/y/w/h 转为 layout.desktop 和 layout.mobile
    const converted = parsed.map((it: any) => {
      if (it.layout && it.layout.desktop && it.layout.mobile) return it
      const x = typeof it.x === 'number' ? it.x : (it.layout?.desktop?.x ?? 20)
      const y = typeof it.y === 'number' ? it.y : (it.layout?.desktop?.y ?? 20)
      const w = typeof it.w === 'number' ? it.w : (it.layout?.desktop?.w ?? 400)
      const h = typeof it.h === 'number' ? it.h : (it.layout?.desktop?.h ?? 300)
      return {
        id: it.id ?? generateId(),
        component: it.component,
        config: it.config ?? it.config,
        layout: {
          desktop: { x, y, w, h },
          mobile: { x, y, w, h },
        },
      }
    })
    state.items = converted
    await nextTick()
    await nextTick()
    if (mobileMode.value) {
      updateCanvasWidth()
      applyMobileLayout()
    }
    state.items.forEach((item) => {
      if (item.component === 'RichTextEditor') {
        const inst = componentRefs.value[item.id]
        const content = (item.config as RichTextConfig).content
        if (inst && content) {
          // 尽量调用编辑器提供的导入方法
          inst.importJSON?.(content)
          // 若编辑器接受 `doc` prop，prop 已在渲染时传入
        }
      }
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

// ---------- 删除功能 ----------
const deleteSelected = () => {
  if (state.selectedIds.size === 0) return
  const ids = Array.from(state.selectedIds)
  state.items = state.items.filter((it) => !ids.includes(it.id))
  state.selectedIds = new Set()
  ids.forEach(id => { delete componentRefs.value[id] })
}

// ---------- 生命周期 ----------
onMounted(() => {
  load()
  nextTick(() => {
    updateCanvasWidth()
    if (mobileMode.value) {
      applyMobileLayout()
    }
  })
  window.addEventListener('resize', onResize)
  window.addEventListener('mousemove', updateSelection)
  window.addEventListener('mouseup', finishSelection)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', updateSelection)
  window.removeEventListener('mouseup', finishSelection)
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

.selection-box {
  position: absolute;
  border: 1px dashed var(--v-theme-primary);
  background: rgba(var(--v-theme-primary), 0.12);
  pointer-events: none;
  z-index: 55;
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