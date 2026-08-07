<template>
  <v-sheet class="editor-wrapper">
    <!-- 工具栏 -->
    <div class="toolbar">
      <v-btn @click="save">保存</v-btn>
      <v-btn @click="load">加载</v-btn>
      <v-btn v-for="comp in ADDABLE_COMPONENTS" :key="comp.key" :data-test="comp.addId" @click="addComponent(comp.key)">
        ➕ 添加{{ comp.label }}
      </v-btn>
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

    <RichTextEditor style="margin: 16px;" v-if="false" />

    <!-- 画布区域 -->
    <div class="canvas-container">
      <div class="canvas" @click="handleCanvasClick" @mousedown="startSelection" @mousemove="updateSelection"
        @focusin="handleCanvasFocusin" ref="canvasRef">
        <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle"></div>
        <VueDraggableResizable v-for="item in state.items" :key="`${item.id}-${mobileMode ? 'm' : 'd'}`"
          :data-id="item.id" :z="itemZ(item.id)" :active="isActive(item.id)"
          :x="layoutOf(item).x" :y="layoutOf(item).y" :w="layoutOf(item).w" :h="layoutOf(item).h"
          :min-width="(constraintsOf(item).minWidth ?? 0) + 8" :min-height="(constraintsOf(item).minHeight ?? 0) + 8"
          :max-width="constraintsOf(item).maxWidth ?? null" :max-height="constraintsOf(item).maxHeight ?? null"
          :is-conflict-check="!mobileMode" :snap="true" :snap-tolerance="10" parent :active-on-top="true"
          :axis="mobileMode ? 'y' : 'both'" :handles="mobileMode ? ['tm', 'bm'] : undefined"
          @dragging="(x, y) => onDragging(item, x, y)" @dragstop="(x, y) => onDragStop(item, x, y)"
          drag-handle=".drag-handle" @resizestop="(x, y, w, h) => onResizeStop(item, x, y, w, h)"
          :disabled="!isEditMode" class="drag-wrapper"
          :class="{ selected: isEditMode && state.selectedIds.has(item.id) }">
          <div class="block-container bg-white elevation-1 rounded">
            <!-- 左上角：名称 + 图标（可拖拽手柄） -->
            <v-sheet v-if="isEditMode" class="drag-handle border border-grey-lighten-2 border-b-0"
              color="grey-lighten-4" rounded="t"
              style="position:absolute; top:-28px; left:10px; height:28px; padding:0 10px; display:flex; align-items:center; cursor:grab; z-index:10; white-space:nowrap;"
              @mousedown="(e: MouseEvent) => handleSelect(item.id, e)">
              <v-icon size="16" color="grey-darken-2" :icon="mdiDragVariant" class="mr-1" />
              <span class="text-caption text-grey-darken-2 user-select-none">
                {{ componentLabelOf(item.component) }}
              </span>
            </v-sheet>

            <!-- 右上角：选中指示器 -->
            <transition name="pop-up">
              <v-sheet v-if="isEditMode && state.selectedIds.has(item.id)"
                class="drag-handle right-handle border border-grey-lighten-2 border-b-0" color="grey-lighten-4"
                rounded="t"
                style="position:absolute; top:-28px; right:10px; height:28px; width:28px; display:flex; align-items:center; justify-content:center; cursor:grab; z-index:10;"
                @mousedown="(e: MouseEvent) => handleSelect(item.id, e)">
                <v-avatar size="12" :style="{ backgroundColor: String(primaryColor) }" />
              </v-sheet>
            </transition>

            <!-- 内容区域 -->
            <div class="content-area">
              <component :is="componentMap[item.component as keyof typeof componentMap]"
                :ref="(el) => setComponentRef(item.id, el)" v-bind="getComponentProps(item)"
                @update:model-value="(val: string) => updateCode(item.id, val)"
                @update:language="(lang: string) => updateLanguage(item.id, lang)" class="inner-component" />
            </div>
          </div>
        </VueDraggableResizable>
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
import EditableCodeBlock, { resizeConstraints as codeBlockConstraints } from '../Controls/EditorPlugin/EditableCodeBlock.vue'
import { normalizeConstraints, type ResizeConstraints } from '../Controls/resizeConstraints'
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

// forceMobile 三态循环：null(自动) -> true(强制移动端) -> false(强制桌面) -> null
const nextForceMobile = (): boolean | null => {
  if (forceMobile.value === null) return true
  if (forceMobile.value === true) return false
  return null
}

const toggleMobileSim = () => {
  syncComponentData() // 模式切换会重挂载组件，先同步组件数据
  forceMobile.value = nextForceMobile() // 布局刷新由 watch(mobileMode) 统一处理
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

// ---------- 可添加组件注册表 ----------
// 新增可添加组件时只需在此注册（key 需对应 componentMap 的键），
// 工具栏按钮、添加逻辑、显示名称会自动生效，无需再写单独的 add 方法。
interface AddableComponentMeta {
  key: CanvasItem['component']
  label: string
  addId: string
  defaultConfig: () => WidgetConfig
  defaultSize: { w: number; h: number }
}

const ADDABLE_COMPONENTS: AddableComponentMeta[] = [
  {
    key: 'RichTextEditor',
    label: '富文本',
    addId: 'add-rich',
    defaultConfig: () => ({ content: null }),
    defaultSize: { w: 400, h: 300 },
  },
  {
    key: 'EditableCodeBlock',
    label: '代码块',
    addId: 'add-code',
    defaultConfig: () => ({
      code: '// 在此编写代码',
      language: 'javascript',
      minWidth: '300px',
      minHeight: '200px',
    }),
    defaultSize: { w: 400, h: 250 },
  },
]

const componentMetaOf = (key: CanvasItem['component']) =>
  ADDABLE_COMPONENTS.find((c) => c.key === key)

const componentLabelOf = (key: CanvasItem['component']) =>
  componentMetaOf(key)?.label ?? key

// ---------- 组件尺寸约束 ----------
// 统一通过组件导出的 `resizeConstraints` 获取最大/最小尺寸（与 vue-component.ts 一致）。
// 未声明约束的组件回退到画布默认（与原行为一致：min 100，宽高不限）。
const componentConstraints: Partial<
  Record<CanvasItem['component'], ResizeConstraints>
> = {
  EditableCodeBlock: codeBlockConstraints,
}

const CANVAS_DEFAULT_CONSTRAINTS: Required<ResizeConstraints> = {
  minWidth: 100,
  maxWidth: null,
  minHeight: 100,
  maxHeight: null,
}

const constraintsOf = (item: CanvasItem): Required<ResizeConstraints> => {
  const raw = componentConstraints[item.component]
  if (!raw) return CANVAS_DEFAULT_CONSTRAINTS
  return normalizeConstraints(raw)
}

// ---------- 响应式状态 ----------
const state = reactive({
  items: [] as CanvasItem[],
  selectedIds: new Set<string>(),
})

// ---------- 顶层 z-index 管理（内容聚焦时把该块提到最上层）----------
const zMap = reactive<Record<string, number>>({})
let zCounter = 0
const itemZ = (id: string): number => zMap[id] ?? 0
const bringToTop = (id: string) => {
  if (zMap[id] === zCounter && zCounter > 0) return // 已是最上层，避免计数器膨胀
  zMap[id] = ++zCounter
}

// 选中即激活 VDR（驱动原生缩放手柄显示）
const isActive = (id: string): boolean => isEditMode.value && state.selectedIds.has(id)

interface ComponentController {
  saveConfig?: () => Partial<WidgetConfig>
  loadConfig?: (config: WidgetConfig) => void
  commands?: Record<string, (...args: any[]) => unknown>
}

const componentRefs = ref<Record<string, ComponentController | undefined>>({})
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
      compact: mobileMode.value,
    }
  }
  if (item.component === 'EditableCodeBlock') {
    const cfg = item.config as CodeBlockConfig
    const c = constraintsOf(item)
    return {
      modelValue: cfg.code,
      language: cfg.language,
      minWidth: `${c.minWidth}px`,
      minHeight: `${c.minHeight}px`,
      maxWidth: c.maxWidth !== null ? `${c.maxWidth}px` : '',
      maxHeight: c.maxHeight !== null ? `${c.maxHeight}px` : '',
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

// 当前端（桌面/移动端）布局
const layoutOf = (item: CanvasItem): Rect => (mobileMode.value ? item.layout.mobile : item.layout.desktop)

const syncItemPosition = (item: CanvasItem, x: number, y: number) => {
  const layout = layoutOf(item)
  layout.x = x
  layout.y = y
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
          return [id, { x: layoutOf(target).x, y: layoutOf(target).y }]
        }),
      ),
    }
  }

  const targetOrigin = dragGroupState.value.origins[item.id] ?? { x: layoutOf(item).x, y: layoutOf(item).y }
  const dx = x - targetOrigin.x
  const dy = y - targetOrigin.y

  getSelectedItemIds(item).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (!target) return
    const origin = dragGroupState.value.origins[id] ?? { x: layoutOf(target).x, y: layoutOf(target).y }
    syncItemPosition(target, origin.x + dx, origin.y + dy)
  })
}

const onDragStop = (item: CanvasItem, x: number, y: number) => {
  dragGroupState.value = { active: false, origins: {} }
  syncItemPosition(item, x, y)
}

const onResizeStop = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const layout = layoutOf(item)
  layout.x = x
  layout.y = y
  layout.w = w
  layout.h = h
}

const handleSelect = (id: string, e?: MouseEvent) => {
  const isSelected = state.selectedIds.has(id)
  const selectedCount = state.selectedIds.size
  const isCtrl = e?.ctrlKey ?? false

  if (isCtrl) {
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

// 内容物获得焦点时：选中该块并把它提到最上层（显示在最前）
const handleCanvasFocusin = (e: FocusEvent) => {
  const target = e.target as HTMLElement
  const wrapper = target.closest<HTMLElement>('.drag-wrapper')
  if (!wrapper) return
  const id = wrapper.dataset.id
  if (!id || !state.items.some((i) => i.id === id)) return
  if (isEditMode.value) {
    handleSelect(id)
  }
  bringToTop(id)
}

// ---------- 同步与存储 ----------
// 统一调用每个组件自定义的 saveConfig，把组件内部数据同步回 item.config
const syncComponentData = () => {
  state.items.forEach((item) => {
    const inst = componentRefs.value[item.id]
    const saved = inst?.saveConfig?.()
    if (saved) {
      item.config = { ...item.config, ...saved } as WidgetConfig
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

// 把单个块的移动端宽度按画布拉伸（x 贴左，宽度占满画布减去左右边距）
const stretchMobileWidth = (item: CanvasItem) => {
  const mobile = item.layout.mobile
  mobile.x = MOBILE_MARGIN
  mobile.w = canvasWidth.value - 2 * MOBILE_MARGIN
}

// 应用移动端布局：宽度始终按画布拉伸；位置/高度缺失时（旧数据）从桌面布局补齐
const applyMobileLayout = () => {
  if (!mobileMode.value || canvasWidth.value <= 0) return
  state.items.forEach(item => {
    stretchMobileWidth(item)
    const { desktop, mobile } = item.layout
    if (mobile.y == null) mobile.y = desktop.y
    if (mobile.h == null) mobile.h = desktop.h
  })
}

const refreshLayout = () => {
  updateCanvasWidth()
  if (mobileMode.value) applyMobileLayout()
}

// flush:'pre'：在组件重挂载前执行，先同步富文本内容
watch(mobileMode, () => {
  syncComponentData()
  nextTick(refreshLayout)
}, { flush: 'pre' })

const onResize = () => refreshLayout()

// ---------- 添加组件 ----------
// 统一入口：根据注册表 ADDABLE_COMPONENTS 生成对应组件实例
const addComponent = (key: CanvasItem['component']) => {
  const meta = componentMetaOf(key)
  if (!meta) return
  const id = generateId()
  const newItem: CanvasItem = {
    id,
    component: key,
    config: meta.defaultConfig(),
    layout: {
      desktop: { x: nextX, y: nextY, ...meta.defaultSize },
      mobile: { x: nextX, y: nextY, ...meta.defaultSize },
    },
  }
  state.items.push(newItem)
  if (mobileMode.value && canvasWidth.value > 0) {
    stretchMobileWidth(newItem)
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
  syncComponentData()
  // 移动端不持久化宽度（运行时按画布拉伸），只存位置与高度
  const serializable = state.items.map((it) => ({
    id: it.id,
    component: it.component,
    config: it.config,
    layout: {
      desktop: { ...it.layout.desktop },
      mobile: { x: it.layout.mobile.x, y: it.layout.mobile.y, h: it.layout.mobile.h },
    },
  }))
  localStorage.setItem('canvasData', JSON.stringify(serializable))
}

const load = async () => {
  const raw = localStorage.getItem('canvasData')
  if (!raw) return
  const parsed = JSON.parse(raw)
  state.items = parsed.map((it: any) => ({
    id: it.id,
    component: it.component,
    config: it.config,
    layout: {
      desktop: { ...it.layout.desktop },
      mobile: { ...it.layout.mobile },
    },
  }))
  await nextTick()
  await nextTick()
  if (mobileMode.value) {
    updateCanvasWidth()
    applyMobileLayout()
  }
  state.items.forEach((item) => {
    // 调用每个组件自定义的 loadConfig 恢复数据
    componentRefs.value[item.id]?.loadConfig?.(item.config)
  })
}

// ---------- 批量操作 ----------
const batchToggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  Array.from(state.selectedIds).forEach((id) => {
    componentRefs.value[id]?.commands?.toggleHeading?.(level)
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
  nextTick(refreshLayout)
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
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
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