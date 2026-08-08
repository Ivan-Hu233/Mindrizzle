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
    
    <!-- 画布区域（无限画布：右键拖拽空白处平移） -->
    <div class="canvas-container" ref="canvasContainerRef" :style="containerStyle">
      <div class="canvas" :class="{ panning: isPanning }" :style="canvasStyle"
        @click="handleCanvasClick" @mousedown="onCanvasMouseDown"
        @mousemove="updateSelection" @focusin="handleCanvasFocusin"
        ref="canvasRef">
        <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle"></div>
        <VueDraggableResizable v-for="item in state.items" :key="`${item.id}-${mobileMode ? 'm' : 'd'}`"
          :data-id="item.id" :z="itemZ(item.id)" :active="isActive(item.id)"
          :x="layoutOf(item).x" :y="layoutOf(item).y" :w="layoutOf(item).w" :h="layoutOf(item).h"
          :min-width="(constraintsOf(item).minWidth ?? 0) + 8" :min-height="(constraintsOf(item).minHeight ?? 0) + 8"
          :max-width="constraintsOf(item).maxWidth ?? null" :max-height="constraintsOf(item).maxHeight ?? null"
          :is-conflict-check="!mobileMode" :snap="true" :snap-tolerance="10" :active-on-top="true"
          :axis="mobileMode ? 'y' : 'both'" :handles="mobileMode ? ['tm', 'bm'] : undefined"
          :draggable="false" drag-handle=".drag-handle"
          @resizestop="(x, y, w, h) => onResizeStop(item, x, y, w, h)"
          :disabled="!isEditMode" class="drag-wrapper"
          :class="{ selected: isEditMode && state.selectedIds.has(item.id) }">
          <div class="block-container bg-white elevation-1 rounded">
            <!-- 可拖拽手柄 -->
            <v-sheet v-if="isEditMode" class="drag-handle border border-grey-lighten-2"
              :class="{ 'handle-bottom': handlePlacementOf(item) === 'bottom' }"
              color="grey-lighten-4" :rounded="handlePlacementOf(item) === 'bottom' ? 'b' : 't'"
              :style="handleBarStyle(item, { left: '10px', padding: '0 10px', display: 'flex', alignItems: 'center', cursor: 'grab', whiteSpace: 'nowrap' })"
              @mousedown="(e: MouseEvent) => startCustomDrag(item, e)">
              <v-icon size="16" color="grey-darken-2" :icon="mdiDragVariant" class="mr-1" />
              <span class="text-caption text-grey-darken-2 user-select-none">
                {{ componentLabelOf(item.component) }}
              </span>
            </v-sheet>

            <!-- 选中指示器 -->
            <transition name="pop-up">
              <v-sheet v-if="isEditMode && state.selectedIds.has(item.id)"
                class="drag-handle right-handle border border-grey-lighten-2"
                :class="{ 'handle-bottom': handlePlacementOf(item) === 'bottom' }" color="grey-lighten-4"
                :rounded="handlePlacementOf(item) === 'bottom' ? 'b' : 't'"
                :style="handleBarStyle(item, { right: '10px', width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab' })"
                @mousedown="(e: MouseEvent) => startCustomDrag(item, e)">
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
import { reactive, ref, nextTick, onMounted, onUnmounted, computed, watch, type CSSProperties } from 'vue'
import VueDraggableResizable from 'vue-draggable-resizable-gorkys'
import 'vue-draggable-resizable-gorkys/style.css'

import { mdiDragVariant } from '@mdi/js'
import RichTextEditor, { resizeConstraints as richTextConstraints } from '../Controls/BaseIrEditor/RichTextEditor.vue'
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
  RichTextEditor: richTextConstraints,
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
const canvasContainerRef = ref<HTMLElement | null>(null)
const canvasWidth = ref(0)

// ---------- 无限画布：平移与拖拽 ----------
// 块的坐标即「世界坐标」（连续实数，可正可负、可任意大），块不受边界约束（VDR 无 parent），
// 可自由拖动到任意位置（无限放置）。平移 pan 无界：世界层整体 transform 移动 (+pan)，
// 块屏幕位置 = 世界坐标 + pan，鼠标拖向哪边内容就跟随哪边（跟手）。
// 点阵背景固定在视口容器上，视口内任何位置视觉都是画布、任何位置右键都能拖拽平移。
const pan = reactive({ x: 0, y: 0 })
const isPanning = ref(false)
const panSession = reactive({
  active: false,
  startClientX: 0,
  startClientY: 0,
  startPanX: 0,
  startPanY: 0,
})

const canvasStyle = computed<CSSProperties>(() => ({
  transform: `translate(${pan.x}px, ${pan.y}px)`,
}))

// 点阵背景放在视口容器上（保证任何位置不露白），但 background-position 随 pan 平移，
// 让点阵跟随画布一起滚动（像真正的无限画布网格）
const containerStyle = computed<CSSProperties>(() => ({
  backgroundPosition: `${pan.x}px ${pan.y}px`,
}))

// ---------- 拖动块到视口边缘时画布自动平移（方向与 block-handle 拖段落一致）----------
// 鼠标靠上/左边缘 → 画布内容下移/右移（露出上方/左侧）；靠下/右 → 上移/左移。
const AUTOPAN_EDGE = 60 // 距视口边缘多少 px 触发
const AUTOPAN_MAX = 8 // 每帧最大平移 px
const autoPan = reactive({ active: false })
const lastMouse = { x: 0, y: 0 }

const updateMousePos = (e: MouseEvent) => {
  lastMouse.x = e.clientX
  lastMouse.y = e.clientY
}

const autoPanTick = () => {
  if (!autoPan.active) return
  const cont = canvasContainerRef.value
  if (cont) {
    const r = cont.getBoundingClientRect()
    let vx = 0
    let vy = 0
    if (lastMouse.x < r.left + AUTOPAN_EDGE) vx = Math.min(r.left + AUTOPAN_EDGE - lastMouse.x, AUTOPAN_MAX)
    else if (lastMouse.x > r.right - AUTOPAN_EDGE) vx = -Math.min(lastMouse.x - (r.right - AUTOPAN_EDGE), AUTOPAN_MAX)
    if (lastMouse.y < r.top + AUTOPAN_EDGE) vy = Math.min(r.top + AUTOPAN_EDGE - lastMouse.y, AUTOPAN_MAX)
    else if (lastMouse.y > r.bottom - AUTOPAN_EDGE) vy = -Math.min(lastMouse.y - (r.bottom - AUTOPAN_EDGE), AUTOPAN_MAX)
    if (vx !== 0 || vy !== 0) {
      if (!mobileMode.value) pan.x += vx
      pan.y += vy
      // 同步补偿被拖拽块坐标：块屏幕位置 = 块坐标 + pan，
      // 鼠标停住时自动平移也不会让块偏离鼠标（与 onCustomDragMove 公式一致）。
      // 移动端锁水平：横向自动平移与横向补偿一并跳过，仅竖向滚动。
      Object.keys(customDragGroup).forEach((id) => {
        const target = state.items.find((it) => it.id === id)
        if (!target) return
        const layout = layoutOf(target)
        if (!mobileMode.value) layout.x -= vx
        layout.y -= vy
      })
    }
  }
  requestAnimationFrame(autoPanTick)
}

const startAutoPan = () => {
  if (autoPan.active) return
  autoPan.active = true
  requestAnimationFrame(autoPanTick)
}

const stopAutoPan = () => {
  autoPan.active = false
}

const startPan = (e: MouseEvent) => {
  if (e.button !== 2) return // 仅右键拖拽平移（不依赖 Vue 的 .right 修饰符，兼容性更稳）
  // 右键菜单已全局禁用，任意位置（含块上）右键拖拽都平移
  e.preventDefault()
  panSession.active = true
  panSession.startClientX = e.clientX
  panSession.startClientY = e.clientY
  panSession.startPanX = pan.x
  panSession.startPanY = pan.y
  isPanning.value = true
}

// 捕获阶段拦截右键 mousedown：确保在任意位置（含块内编辑器 ProseMirror 内部）右键拖拽都能平移，
// 并阻止编辑器等通过 stopPropagation 拦截右键事件。
const handleCanvasMouseDownCapture = (e: MouseEvent) => {
  if (e.button !== 2) return
  startPan(e)
  e.stopPropagation()
}

const updatePan = (e: MouseEvent) => {
  if (!panSession.active) return
  const nx = panSession.startPanX + (e.clientX - panSession.startClientX)
  const ny = panSession.startPanY + (e.clientY - panSession.startClientY)
  // 移动端只需竖直方向无限移动，水平方向锁定（不随平移移动）
  pan.x = mobileMode.value ? 0 : nx
  pan.y = ny
}

const stopPan = () => {
  if (!panSession.active) return
  panSession.active = false
  isPanning.value = false
}

// 界面禁用右键菜单（窗口级全局）：避免右键拖拽平移时弹出原生菜单
const preventContextMenu = (e: Event) => e.preventDefault()

// 供编辑器内 block-handle 拖拽段落时驱动画布自动平移（useBlockDrag 派发该事件）
const onCanvasPanEvent = (e: Event) => {
  const detail = (e as CustomEvent<{ dx?: number; dy?: number }>).detail
  if (!detail) return
  const dx = Number(detail.dx) || 0
  const dy = Number(detail.dy) || 0
  if (dx === 0 && dy === 0) return
  if (!mobileMode.value) pan.x += dx
  pan.y += dy
}
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
    return {
      modelValue: cfg.code,
      language: cfg.language,
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

// ---------- 拖拽手柄 / 选中指示器的上下放置 ----------
// 手柄高 28px，需要块上方留出这么多空间。块贴近画布顶部（上方放不下）时，
// 把拖拽手柄与选中指示器从块上方挪到块下方，避免被画布容器裁剪。
const HANDLE_HEIGHT = 28
// 手柄是否放块下方取决于「块在视口内的位置」（世界坐标 + 平移）：贴近视口顶部时放下方
const handlePlacementOf = (item: CanvasItem): 'top' | 'bottom' =>
  layoutOf(item).y + pan.y < HANDLE_HEIGHT ? 'bottom' : 'top'

// 手柄横条的内联定位样式：上方放不下时贴块底部（bottom:-28px），否则贴块顶部
const handleBarStyle = (item: CanvasItem, extra: CSSProperties = {}): CSSProperties => {
  const bottom = handlePlacementOf(item) === 'bottom'
  return {
    position: 'absolute',
    top: bottom ? 'auto' : '-28px',
    bottom: bottom ? '-28px' : 'auto',
    height: '28px',
    zIndex: 10,
    transform: bottom ? 'translateY(1px)' : 'translateY(-1px)',
    ...extra,
  }
}

const getSelectedItemIds = (item: CanvasItem) => {
  const selected = state.selectedIds.has(item.id) && state.selectedIds.size > 1
    ? Array.from(state.selectedIds)
    : [item.id]
  return selected
}

// ---------- 自定义块拖拽：块跟随鼠标；画布平移自动补偿（无需 hack VDR 内部）----------
// 块世界坐标 = 初始 + 鼠标位移 - (pan - panStart)，因此鼠标动块就动、画布平移块自动补偿。
const customDrag = reactive({
  active: false,
  startClientX: 0,
  startClientY: 0,
  panStartX: 0,
  panStartY: 0,
})
let customDragGroup: Record<string, { x: number; y: number }> = {}

const startCustomDrag = (item: CanvasItem, e: MouseEvent) => {
  if (e.button !== 0) return
  if (!isEditMode.value) return
  handleSelect(item.id, e)
  customDrag.active = true
  customDrag.startClientX = e.clientX
  customDrag.startClientY = e.clientY
  customDrag.panStartX = pan.x
  customDrag.panStartY = pan.y
  // 记录多选组的初始世界坐标
  customDragGroup = {}
  getSelectedItemIds(item).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (target) customDragGroup[id] = { x: layoutOf(target).x, y: layoutOf(target).y }
  })
  window.addEventListener('pointermove', onCustomDragMove)
  window.addEventListener('pointerup', onCustomDragUp)
  window.addEventListener('mousemove', onCustomDragMove)
  window.addEventListener('mouseup', onCustomDragUp)
  e.preventDefault()
  startAutoPan() // 拖到视口边缘时画布自动平移
}

const onCustomDragMove = (e: MouseEvent) => {
  if (!customDrag.active) return
  const dx = e.clientX - customDrag.startClientX
  const dy = e.clientY - customDrag.startClientY
  // 画布平移补偿：块世界坐标 = 初始 + 鼠标位移 - (pan - panStart)
  const panDx = pan.x - customDrag.panStartX
  const panDy = pan.y - customDrag.panStartY
  Object.keys(customDragGroup).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (!target) return
    const origin = customDragGroup[id]
    const layout = layoutOf(target)
    layout.x = mobileMode.value ? origin.x : origin.x + dx - panDx
    layout.y = origin.y + dy - panDy
  })
}

const onCustomDragUp = () => {
  customDrag.active = false
  window.removeEventListener('pointermove', onCustomDragMove)
  window.removeEventListener('pointerup', onCustomDragUp)
  window.removeEventListener('mousemove', onCustomDragMove)
  window.removeEventListener('mouseup', onCustomDragUp)
  stopAutoPan()
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
  // 选择框与块都在世界坐标参考系下比较
  const itemRect = layoutOf(item)
  return itemRect.x < rect.x + rect.w && itemRect.x + itemRect.w > rect.x && itemRect.y < rect.y + rect.h && itemRect.y + itemRect.h > rect.y
}

// 画布 mousedown 统一入口：左键负责框选，右键负责平移（两者互斥）
const onCanvasMouseDown = (e: MouseEvent) => {
  startSelection(e)
  startPan(e)
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
  // 移动端宽度取可见视口(.canvas-container)宽度
  const container = canvasContainerRef.value ?? canvasRef.value
  if (container) {
    canvasWidth.value = container.clientWidth
  }
}

// 把单个块的移动端宽度按画布拉伸（x 贴左，宽度占满整个画布，无左右边距）
const stretchMobileWidth = (item: CanvasItem) => {
  const mobile = item.layout.mobile
  mobile.x = 0
  mobile.w = canvasWidth.value
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
  if (mobileMode.value) pan.x = 0 // 移动端锁水平：切换时归零水平平移，避免块水平偏移
  nextTick(refreshLayout)
}, { flush: 'pre' })

const onResize = () => refreshLayout()

// ---------- 添加组件 ----------
// 统一入口：根据注册表 ADDABLE_COMPONENTS 生成对应组件实例
const addComponent = (key: CanvasItem['component']) => {
  const meta = componentMetaOf(key)
  if (!meta) return
  const id = generateId()
  // 新块放在当前视口可见处：世界坐标 = 视口内偏移 - 平移（屏幕位置 = 世界 + pan = 偏移）
  const baseX = nextX - pan.x
  const baseY = nextY - pan.y
  const newItem: CanvasItem = {
    id,
    component: key,
    config: meta.defaultConfig(),
    layout: {
      desktop: { x: baseX, y: baseY, ...meta.defaultSize },
      mobile: { x: baseX, y: baseY, ...meta.defaultSize },
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
  // 保存为「pan=0 时块的屏幕位置」：世界坐标 + 平移 = 保存时块在视口内的位置，
  // 加载后平移归零从原点查看，保证保存时可见的块打开时仍可见。
  const toSaveRect = (r: Rect) => ({
    x: r.x + pan.x,
    y: r.y + pan.y,
    w: r.w,
    h: r.h,
  })
  // 移动端不持久化宽度（运行时按画布拉伸），只存位置与高度
  const serializable = state.items.map((it) => ({
    id: it.id,
    component: it.component,
    config: it.config,
    layout: {
      desktop: toSaveRect(it.layout.desktop),
      mobile: { x: 0, y: it.layout.mobile.y + pan.y, h: it.layout.mobile.h },
    },
  }))
  localStorage.setItem('canvasData', JSON.stringify(serializable))
}

// 归一化从 localStorage 读出的单个条目：
// 兼容「双端布局」重构（commit 7c65209）前的扁平格式（x/y/w/h 在条目顶层、无 layout），
// 并对缺失的布局/组件/配置用默认值兜底，避免加载旧数据直接崩溃。
const normalizeLoadedItem = (it: any): CanvasItem => {
  const component: CanvasItem['component'] = componentMap[it.component as CanvasItem['component']]
    ? (it.component as CanvasItem['component'])
    : 'RichTextEditor'
  const isLegacyFlat = !it.layout && typeof it.x === 'number' && typeof it.y === 'number'
  const desktop: Rect = isLegacyFlat
    ? { x: it.x, y: it.y, w: it.w ?? 400, h: it.h ?? 300 }
    : { x: 0, y: 0, w: 400, h: 300, ...(it.layout?.desktop ?? {}) }
  const mobile: Rect = { ...desktop, ...(it.layout?.mobile ?? {}) }
  // 坐标兜底：null/undefined 一律归 0，避免拖拽异常数据把块弄丢
  desktop.x = typeof desktop.x === 'number' ? desktop.x : 0
  desktop.y = typeof desktop.y === 'number' ? desktop.y : 0
  mobile.x = typeof mobile.x === 'number' ? mobile.x : 0
  mobile.y = typeof mobile.y === 'number' ? mobile.y : 0
  return {
    id: typeof it.id === 'string' && it.id ? it.id : generateId(),
    component,
    config: (it.config ?? componentMetaOf(component)?.defaultConfig() ?? {}) as WidgetConfig,
    layout: { desktop, mobile },
  }
}

const load = async () => {
  const raw = localStorage.getItem('canvasData')
  if (!raw) return
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return // 数据损坏：静默跳过，不阻塞画布
  }
  // 兼容旧格式（纯 CanvasItem[] 数组）与中间版（{ pan, items } 对象）
  if (Array.isArray(parsed)) {
    state.items = parsed.map(normalizeLoadedItem)
  } else if (parsed && Array.isArray(parsed.items)) {
    state.items = parsed.items.map(normalizeLoadedItem)
  } else {
    return
  }
  // 保存的坐标是 pan=0 时的世界坐标，加载后归零平移从原点查看内容
  pan.x = 0
  pan.y = 0
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
  // 捕获监听挂在视口容器上：整个视口（含负坐标区域、世界层外区域）右键拖拽都能平移
  canvasContainerRef.value?.addEventListener('mousedown', handleCanvasMouseDownCapture, true)
  window.addEventListener('resize', onResize)
  window.addEventListener('mousemove', updateSelection)
  window.addEventListener('mouseup', finishSelection)
  window.addEventListener('mousemove', updatePan)
  window.addEventListener('mouseup', stopPan)
  window.addEventListener('contextmenu', preventContextMenu)
  window.addEventListener('mousemove', updateMousePos)
  window.addEventListener('omnijot:canvas-pan', onCanvasPanEvent)
})

onUnmounted(() => {
  canvasContainerRef.value?.removeEventListener('mousedown', handleCanvasMouseDownCapture, true)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', updateSelection)
  window.removeEventListener('mouseup', finishSelection)
  window.removeEventListener('mousemove', updatePan)
  window.removeEventListener('mouseup', stopPan)
  window.removeEventListener('contextmenu', preventContextMenu)
  window.removeEventListener('mousemove', updateMousePos)
  window.removeEventListener('omnijot:canvas-pan', onCanvasPanEvent)
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
  position: relative;
  overflow: hidden;
  background-color: #f7f8fa;
  /* 点阵背景：background-position 由 containerStyle 动态绑定 pan，随画布平移滚动。
     必须显式 background-repeat: repeat（某些全局样式会把它重置为 no-repeat，
     导致 pan 偏移后点阵单元被移出视口、看起来“看不见点了”） */
  background-image: radial-gradient(circle, #e3e6eb 1px, transparent 1px);
  background-repeat: repeat;
  background-size: 24px 24px;
}

/* 无限画布世界层：与视口同尺寸的绝对定位层，transform 由 TS 的 canvasStyle 绑定
   （translate(pan) 跟随鼠标移动，跟手）。块用世界坐标绝对定位（无边界约束），
   可溢出层外（overflow visible），超出视口的部分由容器 overflow hidden 裁剪；
   点阵背景在视口容器上（固定），因此平移无限但背景始终存在。 */
.canvas {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  cursor: grab;
  will-change: transform;
}

.canvas.panning {
  cursor: grabbing;
  user-select: none;
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

/* 上方空间不够时手柄放块下方：描边与圆角翻转到底部 */
.drag-handle.handle-bottom {
  border-top: 0;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 0 0 4px 4px;
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