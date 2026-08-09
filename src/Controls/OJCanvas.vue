<template>
  <v-sheet class="canvas-container" :ref="setCanvasContainerRef" :style="containerStyle">
    <div class="canvas" :class="{ panning: isPanning }" :style="canvasStyle" @click="handleCanvasClick"
      @mousedown="onCanvasMouseDown" @mousemove="updateSelection" @focusin="handleCanvasFocusin" ref="canvasRef">
      <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle"></div>
      <VueDraggableResizable v-for="item in state.items" :key="`${item.id}-${mobileMode ? 'm' : 'd'}`"
        :data-id="item.id" :z="itemZ(item.id)" :active="isActive(item.id)" :x="layoutOf(item).x" :y="layoutOf(item).y"
        :w="layoutOf(item).w" :h="layoutOf(item).h" :min-width="(constraintsOf(item).minWidth ?? 0) + 8"
        :min-height="(constraintsOf(item).minHeight ?? 0) + 8" :max-width="constraintsOf(item).maxWidth ?? null"
        :max-height="constraintsOf(item).maxHeight ?? null" :is-conflict-check="!mobileMode" :snap="true"
        :snap-tolerance="10" :active-on-top="true" :axis="mobileMode ? 'y' : 'both'"
        :handles="mobileMode ? ['tm', 'bm'] : undefined" :draggable="false" drag-handle=".drag-handle"
        @resizestop="(x, y, w, h) => onResizeStop(item, x, y, w, h)" :disabled="!isEditMode" class="drag-wrapper"
        :class="{ selected: isEditMode && state.selectedIds.has(item.id) }">
        <div class="block-container bg-white elevation-1 rounded">
          <div class="content-area">
            <component :is="componentMap[item.component as keyof typeof componentMap]"
              :ref="(el) => setComponentRef(item.id, el)" v-bind="getComponentProps(item)"
              @update:model-value="(val: string) => updateCode(item.id, val)"
              @update:language="(lang: string) => updateLanguage(item.id, lang)" class="inner-component" />
          </div>
        </div>
      </VueDraggableResizable>

      <!-- 因手柄在块内会被相邻块/compact 编辑器（块间层叠）盖住而点不到，故提升到 .canvas 顶层用块坐标定位 -->
      <template v-for="item in state.items" :key="`handle-${item.id}`">
        <div v-if="isEditMode" class="floating-handle drag-handle"
          :class="{ 'handle-bottom': handlePlacementOf(item) === 'bottom' }"
          :style="handleBarStyle(item, 'left')" @mousedown="(e: MouseEvent) => startCustomDrag(item, e)">
          <v-icon size="16" color="grey-darken-2" :icon="mdiDragVariant" class="mr-1" />
          <span class="text-caption text-grey-darken-2 user-select-none">
            {{ componentLabelOf(item.component) }}
          </span>
        </div>
        <transition name="pop-up">
          <div v-if="isEditMode && state.selectedIds.has(item.id)" class="floating-handle drag-handle right-handle"
            :class="{ 'handle-bottom': handlePlacementOf(item) === 'bottom' }"
            :style="handleBarStyle(item, 'right')" @mousedown="(e: MouseEvent) => startCustomDrag(item, e)">
            <v-avatar size="12" :style="{ backgroundColor: String(primaryColor) }" />
          </div>
        </transition>
      </template>
    </div>
  </v-sheet>
</template>

<script lang="ts">
import type { NodeJSON } from '@prosekit/core'

// 因这些类型需在普通 <script> 中导出供父组件复用，故置于此处
export interface RichTextConfig {
  content: NodeJSON | null
}

export interface CodeBlockConfig {
  code: string
  language: string
}

export type WidgetConfig = RichTextConfig | CodeBlockConfig

export interface ComponentController {
  saveConfig?: () => Partial<WidgetConfig>
  loadConfig?: (config: WidgetConfig) => void
  commands?: Record<string, (...args: any[]) => unknown>
}
</script>

<script setup lang="ts">
import { reactive, ref, nextTick, onMounted, onUnmounted, computed, watch, type CSSProperties } from 'vue'
import VueDraggableResizable from 'vue-draggable-resizable-gorkys'
import 'vue-draggable-resizable-gorkys/style.css'

import { mdiDragVariant } from '@mdi/js'
import RichTextEditor, { resizeConstraints as richTextConstraints } from '../Controls/BaseIrEditor/RichTextEditor.vue'
import EditableCodeBlock, { resizeConstraints as codeBlockConstraints } from '../Controls/EditorPlugin/EditableCodeBlock.vue'
import { normalizeConstraints, type ResizeConstraints } from '../Controls/resizeConstraints'

import { useTheme, useDisplay } from 'vuetify'

const theme = useTheme()
const primaryColor = computed(() => theme.current.value.colors.primary)

const { xs } = useDisplay()
const isMobile = computed(() => xs.value)

// 因 forceMobile 为调试用的三态开关，故 null 表示不强制、走真实断点
const forceMobile = ref<boolean | null>(null)
const mobileMode = computed(() => (forceMobile.value === null ? isMobile.value : forceMobile.value))

const nextForceMobile = (): boolean | null => {
  if (forceMobile.value === null) return true
  if (forceMobile.value === true) return false
  return null
}

const isEditMode = ref(true)

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

const componentMap = {
  RichTextEditor,
  EditableCodeBlock,
}

// 因新增可添加组件只需在此注册（key 对应 componentMap 的键）即可自动驱动工具栏与添加逻辑，故集中于此
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

// 因组件未声明 resizeConstraints 时需回退画布默认（min 100，宽高不限），故统一经 normalizeConstraints 归一
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

const state = reactive({
  items: [] as CanvasItem[],
  selectedIds: new Set<string>(),
})

// 因内容聚焦时需把该块提到最上层（显示在最前），故用 zMap 维护自增计数
const zMap = reactive<Record<string, number>>({})
let zCounter = 0
const itemZ = (id: string): number => zMap[id] ?? 0
const bringToTop = (id: string) => {
  if (zMap[id] === zCounter && zCounter > 0) return // 已是最上层，避免计数器膨胀
  zMap[id] = ++zCounter
}

// 因 VueDraggableResizable 的 active 属性会驱动原生缩放手柄显示，故选中块时置为激活
const isActive = (id: string): boolean => isEditMode.value && state.selectedIds.has(id)

const componentRefs = ref<Record<string, ComponentController | undefined>>({})
const canvasRef = ref<HTMLElement | null>(null)
const canvasContainerRef = ref<HTMLElement | null>(null)

// 因 Vuetify 组件上绑定 ref 拿到的是组件实例而非 DOM 元素，故经 $el 取出根 DOM 以调用 DOM API
const setCanvasContainerRef = (el: unknown) => {
  canvasContainerRef.value = (el as { $el?: HTMLElement } | null)?.$el ?? (el as HTMLElement | null)
}
const canvasWidth = ref(0)

// 因块以世界坐标自由放置（VDR 无 parent 不受边界约束）且平移无界，
// 故点阵背景固定在视口容器上以保证任何位置不露白
const pan = reactive({ x: 0, y: 0 })
const isPanning = ref(false)

// 因块坐标无限增长会导致数据溢出，故坐标过大时重定位画布原点
// （块坐标整体平移并入 origin，屏幕位置 = 存储坐标 + origin + pan 不变）
const origin = reactive({ x: 0, y: 0 })

const rebaseOrigin = (offset: { x: number; y: number }) => {
  const dx = Math.round(offset.x) || 0
  const dy = Math.round(offset.y) || 0
  if (!dx && !dy) return
  // 因移动端锁水平（块 x 恒 0）、水平原点不参与，故仅竖直重定位，
  // 且 desktop/mobile 竖直同步平移，保证切换模式后位置一致
  const effDx = mobileMode.value ? 0 : dx
  state.items.forEach((item) => {
    item.layout.desktop.x -= effDx
    item.layout.desktop.y -= dy
    item.layout.mobile.y -= dy
  })
  origin.x += effDx
  origin.y += dy
}

const ORIGIN_REBASE_THRESHOLD = 1_000_000
const maybeRebaseOrigin = () => {
  if (state.items.length === 0) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  state.items.forEach((it) => {
    const l = it.layout.desktop
    if (l.x < minX) minX = l.x
    if (l.y < minY) minY = l.y
    if (l.x > maxX) maxX = l.x
    if (l.y > maxY) maxY = l.y
  })
  const maxAbs = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY))
  if (maxAbs <= ORIGIN_REBASE_THRESHOLD) return
  rebaseOrigin({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 })
}

const panSession = reactive({
  active: false,
  startClientX: 0,
  startClientY: 0,
  startPanX: 0,
  startPanY: 0,
})

// 因 transform 落亚像素会被浏览器渲染发虚，故 pan + origin 取整
const canvasStyle = computed<CSSProperties>(() => ({
  transform: `translate(${Math.round(pan.x + origin.x)}px, ${Math.round(pan.y + origin.y)}px)`,
}))

// 因点阵背景需在任意平移位置都不露白，故固定在视口容器上且 background-position 随 pan 平移
const containerStyle = computed<CSSProperties>(() => ({
  backgroundPosition: `${pan.x}px ${pan.y}px`,
}))

// 因块被拖到视口边缘时画布需自动平移（方向与 block-handle 拖段落一致），故按距边缘距离驱动每帧平移
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
      if (!mobileMode.value) pan.x += Math.round(vx)
      pan.y += Math.round(vy)
      // 因自动平移时鼠标停住块也不应偏离（块屏幕位置 = 块坐标 + pan），故同步补偿被拖拽块坐标
      // 因移动端锁水平，故横向自动平移与横向补偿一并跳过，仅竖向滚动
      Object.keys(customDragGroup).forEach((id) => {
        const target = state.items.find((it) => it.id === id)
        if (!target) return
        const layout = layoutOf(target)
        if (!mobileMode.value) layout.x -= Math.round(vx)
        layout.y -= Math.round(vy)
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
  // 因需任意位置右键拖拽都平移，故仅响应右键且不依赖 Vue 的 .right 修饰符（兼容性更稳）
  if (e.button !== 2) return
  // 右键菜单已全局禁用，任意位置（含块上）右键拖拽都平移
  e.preventDefault()
  panSession.active = true
  panSession.startClientX = e.clientX
  panSession.startClientY = e.clientY
  panSession.startPanX = pan.x
  panSession.startPanY = pan.y
  isPanning.value = true
}

// 因编辑器（ProseMirror）内部会通过 stopPropagation 拦截右键事件，故在捕获阶段拦截以确保任意位置右键拖拽都能平移
const handleCanvasMouseDownCapture = (e: MouseEvent) => {
  if (e.button !== 2) return
  startPan(e)
  e.stopPropagation()
}

const updatePan = (e: MouseEvent) => {
  if (!panSession.active) return
  const nx = panSession.startPanX + (e.clientX - panSession.startClientX)
  const ny = panSession.startPanY + (e.clientY - panSession.startClientY)
  // 因触摸/缩放屏下 clientX 可能为小数、亚像素平移会致界面模糊，故取整
  // 因移动端锁水平，故仅竖直方向平移、水平锁定
  pan.x = mobileMode.value ? 0 : Math.round(nx)
  pan.y = Math.round(ny)
}

const stopPan = () => {
  if (!panSession.active) return
  panSession.active = false
  isPanning.value = false
  maybeRebaseOrigin() // 平移结束：坐标过大时无感重定位原点
}

// 因右键拖拽平移时需避免弹出原生菜单，故窗口级全局禁用右键菜单
const preventContextMenu = (e: Event) => e.preventDefault()

// 因编辑器内 block-handle 拖拽段落时需画布自动平移（useBlockDrag 派发该事件），故监听该事件并取整避免落亚像素
const onCanvasPanEvent = (e: Event) => {
  const detail = (e as CustomEvent<{ dx?: number; dy?: number }>).detail
  if (!detail) return
  const dx = Number(detail.dx) || 0
  const dy = Number(detail.dy) || 0
  if (dx === 0 && dy === 0) return
  if (!mobileMode.value) pan.x += Math.round(dx)
  pan.y += Math.round(dy)
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

const layoutOf = (item: CanvasItem): Rect => (mobileMode.value ? item.layout.mobile : item.layout.desktop)

// 因手柄高 28px、块贴近视口顶部时上方放不下（会被画布容器裁剪），
// 故按块在视口内的位置（存储坐标 + 原点 + 平移）决定手柄放上/下方
const HANDLE_HEIGHT = 28
const handlePlacementOf = (item: CanvasItem): 'top' | 'bottom' =>
  layoutOf(item).y + origin.y + pan.y < HANDLE_HEIGHT ? 'bottom' : 'top'

const handleBarStyle = (item: CanvasItem, side: 'left' | 'right'): CSSProperties => {
  const layout = layoutOf(item)
  const bottom = handlePlacementOf(item) === 'bottom'
  return {
    position: 'absolute',
    // 因手柄提升到 .canvas 顶层（已应用 pan+origin 变换），故用块存储坐标直接定位
    top: `${bottom ? layout.y + layout.h : layout.y - HANDLE_HEIGHT}px`,
    left: `${side === 'left' ? layout.x + 10 : layout.x + layout.w - 38}px`,
    height: `${HANDLE_HEIGHT}px`,
    // 因手柄脱离块内层叠上下文后需高于所有块（VDR :z），故置 999
    zIndex: 999,
    ...(side === 'left'
      ? { padding: '0 10px', display: 'flex', alignItems: 'center', cursor: 'grab', whiteSpace: 'nowrap' }
      : { width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab' }),
    // 因内联 transform 优先级高于 Vue transition 的 class 会压掉滑出动画（只剩 opacity 生效），
    // 故改用 CSS 变量 --handle-y（贴边 ±1px 微调）+ --handle-slide（滑出方向）由 CSS 组合进动画
    '--handle-y': bottom ? '1px' : '-1px',
    '--handle-slide': bottom ? '-28px' : '28px',
  }
}

const getSelectedItemIds = (item: CanvasItem) => {
  const selected = state.selectedIds.has(item.id) && state.selectedIds.size > 1
    ? Array.from(state.selectedIds)
    : [item.id]
  return selected
}

// 因需块跟随鼠标且画布平移时块自动补偿（无需 hack VDR 内部），
// 故块世界坐标 = 初始 + 鼠标位移 - (pan - panStart)
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
  // 因拖拽中鼠标会扫过编辑器触发 block-handle popup/高亮，故复用 body 类跨编辑器全局抑制
  document.body.classList.add('block-handle-dragging')
  // 因拖拽中块可能超出视口使 document 出现竖向滚动条，故临时锁 html/body 滚动、松开恢复
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  startAutoPan() // 拖到视口边缘时画布自动平移
}

const onCustomDragMove = (e: MouseEvent) => {
  if (!customDrag.active) return
  const dx = e.clientX - customDrag.startClientX
  const dy = e.clientY - customDrag.startClientY
  const panDx = pan.x - customDrag.panStartX
  const panDy = pan.y - customDrag.panStartY
  Object.keys(customDragGroup).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (!target) return
    const origin = customDragGroup[id]
    const layout = layoutOf(target)
    // 因块屏幕位置（= 块坐标 + pan）需落在整数像素上，故取整
    layout.x = mobileMode.value ? origin.x : Math.round(origin.x + dx - panDx)
    layout.y = Math.round(origin.y + dy - panDy)
  })
}

// 因 VDR 自带冲突检测仅在它自己的 dragging/resizing 结束触发，而块拖拽走自定义路径（draggable=false），
// 故松开时自行检测被拖块与其他块重叠，重叠则回退到拖拽起点
const resolveDragConflict = () => {
  const draggedIds = new Set(Object.keys(customDragGroup))
  state.items.forEach((target) => {
    if (!draggedIds.has(target.id)) return
    const layout = layoutOf(target)
    const conflict = state.items.some((other) => {
      if (other.id === target.id || draggedIds.has(other.id)) return false
      const ol = layoutOf(other)
      return layout.x < ol.x + ol.w && layout.x + layout.w > ol.x && layout.y < ol.y + ol.h && layout.y + layout.h > ol.y
    })
    if (conflict) {
      const origin = customDragGroup[target.id]
      layout.x = origin.x
      layout.y = origin.y
    }
  })
}

const onCustomDragUp = () => {
  customDrag.active = false
  window.removeEventListener('pointermove', onCustomDragMove)
  window.removeEventListener('pointerup', onCustomDragUp)
  window.removeEventListener('mousemove', onCustomDragMove)
  window.removeEventListener('mouseup', onCustomDragUp)
  stopAutoPan()
  // 因拖拽结束需恢复编辑器 popup/高亮，故移除 body 拖拽类
  document.body.classList.remove('block-handle-dragging')
  // 因拖拽可能把块拖出视口致 document 出现滚动条，故恢复滚动并回退冲突块
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  resolveDragConflict()
  maybeRebaseOrigin() // 拖拽结束：坐标过大时无感重定位原点
}

const onResizeStop = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const layout = layoutOf(item)
  // 因缩放结果落亚像素会发虚，故取整
  layout.x = Math.round(x)
  layout.y = Math.round(y)
  layout.w = Math.round(w)
  layout.h = Math.round(h)
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
    // 因拖拽手柄时不应把多选收缩为单选，故保留当前集合
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
  // 因选择框坐标需与块 layout 同一参考系（均存储坐标），故减 origin
  selectionState.startX = e.clientX - rect.left - origin.x
  selectionState.startY = e.clientY - rect.top - origin.y
  selectionState.currentX = selectionState.startX
  selectionState.currentY = selectionState.startY
  updateSelectionBox()
}

const updateSelection = (e: MouseEvent) => {
  if (!selectionState.active) return
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  e.preventDefault()
  selectionState.currentX = e.clientX - rect.left - origin.x
  selectionState.currentY = e.clientY - rect.top - origin.y
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

// 因各组件内部数据需统一同步回 item.config，故经组件自定义的 saveConfig 接口收集
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

const updateCanvasWidth = () => {
  const container = canvasContainerRef.value ?? canvasRef.value
  if (container) {
    canvasWidth.value = container.clientWidth
  }
}

const stretchMobileWidth = (item: CanvasItem) => {
  const mobile = item.layout.mobile
  mobile.x = 0
  mobile.w = canvasWidth.value
}

const applyMobileLayout = () => {
  if (!mobileMode.value || canvasWidth.value <= 0) return
  state.items.forEach(item => {
    stretchMobileWidth(item)
    const { desktop, mobile } = item.layout
    // 因旧数据可能缺失移动端位置/高度，故从桌面布局补齐
    if (mobile.y == null) mobile.y = desktop.y
    if (mobile.h == null) mobile.h = desktop.h
  })
}

const refreshLayout = () => {
  updateCanvasWidth()
  if (mobileMode.value) applyMobileLayout()
}

// 因需在组件重挂载前先同步富文本内容，故用 flush: 'pre'
watch(mobileMode, () => {
  syncComponentData()
  if (mobileMode.value) {
    // 因移动端锁水平，故将水平原点偏移并入桌面布局并归零，切换回桌面时位置不变、无感
    if (origin.x) {
      state.items.forEach((it) => { it.layout.desktop.x += origin.x })
      origin.x = 0
    }
    pan.x = 0 // 因移动端锁水平，故切换时归零水平平移，避免块水平偏移
  }
  nextTick(refreshLayout)
}, { flush: 'pre' })

const onResize = () => refreshLayout()

const addComponent = (key: CanvasItem['component']) => {
  const meta = componentMetaOf(key)
  if (!meta) return
  const id = generateId()
  // 因新块需落在当前视口可见处（屏幕位置 = 存储坐标 + 原点 + pan），故存储坐标 = 视口内偏移 - 原点 - 平移
  const baseX = nextX - pan.x - origin.x
  const baseY = nextY - pan.y - origin.y
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

const save = () => {
  syncComponentData()
  // 因块坐标需保持小值避免数据溢出，故以块群包围盒中心为新原点保存相对坐标，
  // 并用 origin 记录原点，加载时还原（视觉不变）
  const absOf = (r: Rect) => ({ x: r.x + origin.x + pan.x, y: r.y + origin.y + pan.y })
  let cx = 0, cy = 0
  if (state.items.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    state.items.forEach((it) => {
      const a = absOf(it.layout.desktop)
      if (a.x < minX) minX = a.x
      if (a.y < minY) minY = a.y
      if (a.x > maxX) maxX = a.x
      if (a.y > maxY) maxY = a.y
    })
    cx = Math.round((minX + maxX) / 2)
    cy = Math.round((minY + maxY) / 2)
  }
  const toSaveRect = (r: Rect) => ({
    // 因加载后块坐标需为整数（打开即清晰），故保存时取整
    x: Math.round(r.x + origin.x + pan.x - cx),
    y: Math.round(r.y + origin.y + pan.y - cy),
    w: Math.round(r.w),
    h: Math.round(r.h),
  })
  // 因移动端宽度运行时按画布拉伸，故不持久化，只存位置与高度
  const serializable = state.items.map((it) => ({
    id: it.id,
    component: it.component,
    config: it.config,
    layout: {
      desktop: toSaveRect(it.layout.desktop),
      mobile: { x: 0, y: Math.round(it.layout.mobile.y + origin.y + pan.y - cy), h: Math.round(it.layout.mobile.h) },
    },
  }))
  return JSON.stringify({ origin: { x: cx, y: cy }, items: serializable })
}

// 因需兼容「双端布局」重构（commit 7c65209）前的扁平格式并对缺失字段兜底，
// 故归一化加载条目，避免旧数据崩溃
const normalizeLoadedItem = (it: any): CanvasItem => {
  const component: CanvasItem['component'] = componentMap[it.component as CanvasItem['component']]
    ? (it.component as CanvasItem['component'])
    : 'RichTextEditor'
  const isLegacyFlat = !it.layout && typeof it.x === 'number' && typeof it.y === 'number'
  const desktop: Rect = isLegacyFlat
    ? { x: it.x, y: it.y, w: it.w ?? 400, h: it.h ?? 300 }
    : { x: 0, y: 0, w: 400, h: 300, ...(it.layout?.desktop ?? {}) }
  const mobile: Rect = { ...desktop, ...(it.layout?.mobile ?? {}) }
  // 因坐标异常（null/undefined）会使块被弄丢，故一律归 0
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

const load = async (raw: string) => {
  if (!raw) return
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return // 数据损坏：静默跳过，不阻塞画布
  }
  // 因需兼容旧格式（数组 / { pan, items } / { origin, items }），故分别处理
  if (Array.isArray(parsed)) {
    state.items = parsed.map(normalizeLoadedItem)
    origin.x = 0
    origin.y = 0
  } else if (parsed && Array.isArray(parsed.items)) {
    state.items = parsed.items.map(normalizeLoadedItem)
    // 因新版以 origin 还原视觉位置，故加载之；旧数据无 origin 则归零
    origin.x = typeof parsed.origin?.x === 'number' ? parsed.origin.x : 0
    origin.y = typeof parsed.origin?.y === 'number' ? parsed.origin.y : 0
  } else {
    return
  }
  // 因保存坐标相对 origin 归一化，故加载后归零平移、从原点查看内容
  pan.x = 0
  pan.y = 0
  await nextTick()
  await nextTick()
  if (mobileMode.value) {
    // 因移动端块贴左（x 恒 0）而屏幕位置 = 存储坐标 + origin + pan，
    // 故加载时 origin.x 非 0 会把块水平顶出屏外；并入 desktop.x 并归零（与模式切换 watch 一致）
    if (origin.x) {
      state.items.forEach((it) => { it.layout.desktop.x += origin.x })
      origin.x = 0
    }
    updateCanvasWidth()
    applyMobileLayout()
  }
  state.items.forEach((item) => {
    componentRefs.value[item.id]?.loadConfig?.(item.config)
  })
}

const batchToggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  Array.from(state.selectedIds).forEach((id) => {
    componentRefs.value[id]?.commands?.toggleHeading?.(level)
  })
}

const deleteSelected = () => {
  if (state.selectedIds.size === 0) return
  const ids = Array.from(state.selectedIds)
  state.items = state.items.filter((it) => !ids.includes(it.id))
  state.selectedIds = new Set()
  ids.forEach(id => { delete componentRefs.value[id] })
}

onMounted(() => {
  nextTick(refreshLayout)
  // 因整个视口（含负坐标区域、世界层外区域）右键拖拽都需平移，故捕获监听挂在视口容器上
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

defineExpose({
  state,
  pan,
  origin,
  isPanning,
  canvasStyle,
  containerStyle,
  selectionBoxStyle,
  ADDABLE_COMPONENTS,
  isEditMode,
  forceMobile,
  componentRefs,
  nextForceMobile,
  syncComponentData,
  layoutOf,
  handlePlacementOf,
  handleBarStyle,
  getComponentProps,
  updateCode,
  updateLanguage,
  setComponentRef,
  addComponent,
  save,
  load,
  rebaseOrigin,
  batchToggleHeading,
  deleteSelected,
})
</script>

<style scoped>
.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: #f7f8fa;
  /* 因全局样式可能把 background-repeat 重置为 no-repeat 导致 pan 偏移后点阵移出视口，
     故显式设为 repeat，且 background-position 随 pan 平移滚动 */
  background-image: radial-gradient(circle, #e3e6eb 1px, transparent 1px);
  background-repeat: repeat;
  background-size: 24px 24px;
}

/* 因块用世界坐标定位可溢出层外，故超出视口的部分由容器 overflow hidden 裁剪；
   因平移无界，故点阵背景固定在视口容器上以保证背景始终存在 */
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

.drag-wrapper :deep(.handle) {
  z-index: 20;
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

/* 因手柄提升到 .canvas 顶层（脱离块内层叠上下文），
   故覆盖 .drag-handle/.right-handle 的块内定位（bottom:100% 等）以纯 top/left 定位 */
.floating-handle {
  position: absolute;
  bottom: auto;
  z-index: 999;
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
  z-index: 16;
  padding: 0 10px;
  white-space: nowrap;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.2s;
  /* 贴边 ±1px 微调由内联 --handle-y 变量提供（替代原内联 transform） */
  transform: translateY(var(--handle-y, -1px));
}

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
}

.right-handle {
  bottom: 100%;
  right: 10px;
  width: 28px;
  justify-content: center;
  padding: 0;
  z-index: 16;
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
  /* 因需盖住"从块内滑出"阶段的手柄（z-index:10）又不挡缩放手柄（.handle 的 z-index:20），
     故置于 z-index:15 */
  position: relative;
  z-index: 15;
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

/* 因 top/bottom 放置时滑出方向相反，故由 handleBarStyle 提供 --handle-slide 变量驱动动画 */
.pop-up-enter-from {
  opacity: 0;
  transform: translateY(calc(var(--handle-y, 0px) + var(--handle-slide, 28px)));
}

.pop-up-enter-to {
  opacity: 1;
  transform: translateY(var(--handle-y, 0px));
}

.pop-up-leave-from {
  opacity: 1;
  transform: translateY(var(--handle-y, 0px));
}

.pop-up-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--handle-y, 0px) + var(--handle-slide, 28px)));
}
</style>