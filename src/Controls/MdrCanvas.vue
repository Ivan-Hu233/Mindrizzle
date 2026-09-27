<template>
  <v-sheet class="canvas-container" color="surface" :ref="setCanvasContainerRef" :style="containerStyle" @click="handleCanvasClick"
    @mousedown="onCanvasMouseDown" @mousemove="onCanvasMousemove" @focusin="handleCanvasFocusin">
    <!-- background-position 平移会每帧重绘整容器，所以独立成层用 transform 合成移动 -->
    <div class="canvas-dots" :style="dotsStyle" aria-hidden="true" />
    <!-- .canvas 平移后不覆盖整容器，所以事件挂容器级；data-layout-version 仅为订阅 layout 版本号（块已 markRaw） -->
    <div class="canvas" :class="{ panning: isPanning }" :style="canvasStyle" :data-layout-version="layoutVersion"
      ref="canvasRef">
      <!-- SVG 在非整数坐标下光栅化易断续，所以用 HTML 色条渲染 -->
      <div class="connection-layer" aria-hidden="true">
        <div v-for="line in linkedConnections" :key="line.key" class="connection-segment"
          :style="connectionSegmentStyle(line)" />
      </div>
      <ResizeBox v-for="item in state.items" :key="`${item.id}-${mobileMode ? 'm' : 'd'}`"
        :data-id="item.id" :item-id="item.id" :z-index="blockZ(item.id)" :active="isActive(item.id)" :x="layoutOf(item).x"
        :y="layoutOf(item).y" :w="layoutOf(item).w" :h="layoutOf(item).h"
        :min-width="(constraintsOf(item).minWidth ?? 0) + 8" :min-height="(constraintsOf(item).minHeight ?? 0) + 8"
        :max-width="constraintsOf(item).maxWidth ?? null" :max-height="constraintsOf(item).maxHeight ?? null"
        :handles="resizeHandlesOf(item)" :disabled="!isEditMode" :dragging="customDrag.draggingIds.has(item.id)" :zoom="zoom"
        @resizestart="resizeCallbacksOf(item).start" @resizing="resizeCallbacksOf(item).resizing"
        @resizestop="resizeCallbacksOf(item).resizestop" class="drag-wrapper"
        :class="{ selected: isEditMode && state.selectedIds.has(item.id), 'popup-open': popupBlockId === item.id, 'drag-passthrough': customDrag.draggingIds.has(item.id) }">
        <v-sheet class="block-container" color="surface" elevation="0" rounded :style="cornerStyleOf(item.id)">
          <!-- 只盖接触段、露出段保留边框，所以按段渲染同色遮罩 -->
          <template v-for="m in masksOf(item.id)" :key="`${m.side}-${m.start}`">
            <div class="edge-mask" :style="maskStyle(m)" />
          </template>
          <div class="content-area">
            <component :is="componentMap[item.component as keyof typeof componentMap]"
              :ref="componentRefOf(item)" v-bind="getComponentProps(item)"
              @update:model-value="(val: string) => updateCode(item.id, val)"
              @update:language="(lang: string) => updateLanguage(item.id, lang)" class="inner-component" />
          </div>
        </v-sheet>
      </ResizeBox>

      <v-fade-transition :duration="120">
        <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle"></div>
      </v-fade-transition>
      <Transition name="pop-up">
        <!-- 多选时多个拖拽栏互相干扰，所以只显 hover 命中块（拖拽中只显源块） -->
        <div v-if="floatingHandleItem" :key="floatingHandleItem.id" class="floating-handle drag-handle"
          :class="{ 'handle-bottom': handlePlacementOf(floatingHandleItem) === 'bottom' }"
          :data-id="floatingHandleItem.id" :style="handleBarStyle(floatingHandleItem)"
          @mousedown="onFloatingHandleDown">
          <v-icon size="16" color="on-surface-variant" :icon="mdiDragVariant" class="mr-1" />
          <span class="text-caption text-medium-emphasis user-select-none">
            {{ componentLabelOf(floatingHandleItem.component) }}
          </span>
        </div>
      </Transition>

      <!-- 块级设置需独立于内容区，所以在块右侧单开一栏 -->
      <Transition name="pop-up">
        <div v-if="sideSettingsItem" :key="sideSettingsItem.id"
          class="side-settings" :class="{ 'handle-bottom': handlePlacementOf(sideSettingsItem) === 'bottom' }"
          :data-id="sideSettingsItem.id" :style="sideSettingsStyle(sideSettingsItem)">
          <v-menu location="bottom end" :close-on-content-click="false" :close-on-back="false">
            <template #activator="{ props: menuProps }">
              <v-btn v-bind="menuProps" size="x-small" variant="tonal" color="grey" icon
                title="块设置" @mousedown.stop @click.stop>
                <v-icon :icon="mdiCogOutline" size="13" />
              </v-btn>
            </template>
            <v-card min-width="240" class="auto-height-menu">
              <v-list density="compact">
                <v-list-item>
                  <v-switch :model-value="isAutoHeight(sideSettingsItem)" color="primary"
                    label="高度自适应内容" hint="块高随内容自动调整" persistent-hint hide-details
                    @update:model-value="onAutoHeightToggle" />
                </v-list-item>
              </v-list>
            </v-card>
          </v-menu>
        </div>
      </Transition>

      <!-- 描边需在拖拽栏之上保持连贯，所以用独立高层 overlay 渲染（data-id 供拖拽期命令式跟随） -->
      <template v-for="item in selectedOutlineItems" :key="`outline-${item.id}`">
        <v-fade-transition :duration="120">
          <div class="selected-outline" :data-id="item.id" :style="selectedOutlineStyle(item)" />
        </v-fade-transition>
      </template>

      <div v-if="richTextDropTargetId" class="rich-text-drop-target"
        :style="richTextDropTargetStyle" aria-hidden="true" />

      <!-- 落点线要随画布 zoom/pan 变换，所以用 content 坐标定位在 .canvas 内 -->
      <div v-if="richTextDrop" class="rich-text-drop-line" :style="richTextDropLineStyle" aria-hidden="true" />

      <template v-for="p in paperclipCandidates" :key="`clip-${p.a}-${p.b}`">
        <div class="snap-paperclip" v-show="nearClipKey === p.key" :class="{ linked: p.linked }"
          :style="{ left: `${roundToPx(p.x)}px`, top: `${roundToPx(p.y)}px` }"
          :title="p.linked ? '点击分离' : '点击粘贴'"
          @mousedown.stop @click.stop="toggleLink(p.a, p.b)">
          <v-icon size="16" :icon="mdiPaperclip" />
        </div>
      </template>

      <div v-if="addPreviewPos && addPreviewKey && previewVisible" class="add-preview" :style="addPreviewStyle">
        <span class="add-preview-label">{{ componentLabelOf(addPreviewKey) }}</span>
      </div>
    </div>
    <!-- 箭头用屏幕坐标、不随画布变换，所以定位在容器层 -->
    <div v-if="addPreviewPos && addPreviewKey && !previewVisible" class="add-preview-arrow" :style="previewArrowStyle">
      <v-icon :icon="mdiArrowUp" size="16" />
    </div>
  </v-sheet>
</template>

<script lang="ts">
export type {
  CanvasItem,
  ComponentController,
  RichTextConfig,
  CodeBlockConfig,
  WidgetConfig,
} from './canvasComponents.ts'
</script>

<script setup lang="ts">
import { reactive, ref, shallowRef, nextTick, onMounted, onUnmounted, computed, watch, markRaw, type CSSProperties } from 'vue'
import ResizeBox from './ResizeBox.vue'

import { mdiDragVariant, mdiPaperclip, mdiCogOutline, mdiArrowUp } from '@mdi/js'
import {
  ADDABLE_COMPONENTS,
  componentLabelOf,
  componentMap,
  componentMetaOf,
  constraintsOf,
  type CanvasItem,
  type ComponentController,
  type RichTextConfig,
  type CodeBlockConfig,
  type Rect,
  type WidgetConfig,
} from './canvasComponents.ts'
import type { ResizeConstraints } from './resizeConstraints.ts'
import { Z_LAYER } from './zIndex.ts'
import { roundToVisual, contentToScreen, screenToContent, contentToVisual, type CanvasTransform, type Point, type ViewportOrigin } from '../utils/canvasCoords.ts'
import { getVisibleBlockRect, isFullyVisibleInCanvas, invalidateCanvasScaleCache } from './RichEditor/extensions/blockHandleUtils.ts'

import { useDisplay } from 'vuetify'

// #region 显示模式
const { xs } = useDisplay()
const isMobile = computed(() => xs.value)

// 要支持三态调试，所以 null 表示不强制、走真实断点
const forceMobile = ref<boolean | null>(null)
const mobileMode = computed(() => (forceMobile.value === null ? isMobile.value : forceMobile.value))

const nextForceMobile = (): boolean | null => {
  if (forceMobile.value === null) return true
  if (forceMobile.value === true) return false
  return null
}

const isEditMode = ref(true)
// #endregion 显示模式

// #region 画布状态与 z 层
const state = reactive({
  items: [] as CanvasItem[],
  selectedIds: new Set<string>(),
})

// 块对象已 markRaw（拖拽逐帧写 layout 不再触发全表 diff），所以纯几何变更须经版本号显式刷新
const layoutVersion = ref(0)
const markLayoutDirty = () => { layoutVersion.value++ }

// 叠加层 z 固定（见 zIndex.ts），所以 zCounter 达阈值时按当前顺序重排为 1..N，防普通块盖住叠加层
const zMap = reactive<Record<string, number>>({})
let zCounter = 0
const Z_LIMIT = Z_LAYER.itemZLimit
const itemZ = (id: string): number => zMap[id] ?? 0
const normalizeZMap = () => {
  const ids = Object.keys(zMap).sort((a, b) => zMap[a] - zMap[b])
  ids.forEach((id, i) => { zMap[id] = i + 1 })
  zCounter = ids.length
}
const bringToTop = (id: string) => {
  if (zMap[id] === zCounter && zCounter > 0) return
  zMap[id] = ++zCounter
  if (zCounter >= Z_LIMIT) normalizeZMap()
}

// 邻块会盖住块边缘内侧的缩放手柄，所以选中块 z 取 Z_LAYER.selectedBlock 提层
const SELECTED_Z_BASE = Z_LAYER.selectedBlock
const blockZ = (id: string): number => {
  const isSelected = isEditMode.value && state.selectedIds.has(id)
  const isDragging = customDrag.active && customDrag.draggingIds.has(id)
  const base = isSelected ? SELECTED_Z_BASE : 0
  return Math.max(itemZ(id), isDragging ? Z_LAYER.dragHandle : base)
}

const isActive = (id: string): boolean => isEditMode.value && state.selectedIds.has(id)

const componentRefs = ref<Record<string, ComponentController | undefined>>({})
const canvasRef = ref<HTMLElement | null>(null)
const canvasContainerRef = ref<HTMLElement | null>(null)

// Vuetify 组件 ref 是实例而非 DOM，所以经 $el 取根元素
const setCanvasContainerRef = (el: unknown) => {
  canvasContainerRef.value = (el as { $el?: HTMLElement } | null)?.$el ?? (el as HTMLElement | null)
}
const canvasWidth = ref(0)
// 每帧读取容器矩形会触发 reflow，所以缓存并在挂载/resize 时刷新
const viewRect = ref<{ left: number; top: number; right: number; bottom: number } | null>(null)
const refreshViewRect = () => {
  const cr = canvasContainerRef.value?.getBoundingClientRect()
  viewRect.value = cr ? { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom } : null
}
// #endregion 画布状态与 z 层

// 平移无界，所以点阵背景固定在视口容器上
// #region 平移与原点重定位
const pan = reactive({ x: 0, y: 0 })
const isPanning = ref(false)

// 坐标无限增长会溢出，所以过大时把块坐标整体并入 origin 重定位（屏幕位置不变）
const origin = reactive({ x: 0, y: 0 })

// 换算需统一的 zoom/origin/pan，所以构造一次性快照
const canvasTransform = (): CanvasTransform => ({
  zoom: zoom.value,
  origin: { x: origin.x, y: origin.y },
  pan: { x: pan.x, y: pan.y },
})

const rebaseOrigin = (offset: { x: number; y: number }) => {
  const dx = Math.round(offset.x) || 0
  const dy = Math.round(offset.y) || 0
  if (!dx && !dy) return
  // 移动端锁水平，所以仅竖直重定位且两端同步，保证切换模式后位置一致
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
// #endregion 平移与原点重定位

// zoom 供 canvas 变换与各交互换算共用（交互坐标按 /zoom 换算）
// #region 缩放与画布变换
const zoom = ref(1)
// zoom 下几何值需对齐视觉像素，所以避免边框/浮层落在半像素
const roundToPx = (v: number) => roundToVisual(zoom.value, v)
const visualY = (v: number) => contentToVisual(canvasTransform(), 0, v).y

// .canvas 以左上角为缩放锚点会让中心内容跑偏，所以以容器中心反解补偿 pan
let zoomAnchorPrev = 1
watch(zoom, (z2) => {
  const z1 = zoomAnchorPrev
  zoomAnchorPrev = z2
  if (z1 === z2) return
  const cont = canvasContainerRef.value
  if (!cont) return
  const w = cont.clientWidth
  const h = cont.clientHeight
  if (!mobileMode.value) pan.x = Math.round(pan.x + (w / 2 - (pan.x + origin.x)) * (1 - z2 / z1))
  pan.y = Math.round(pan.y + (h / 2 - (pan.y + origin.y)) * (1 - z2 / z1))
})

// block-handle 弹层为 fixed 视口定位、需随画布重算，所以 pan/zoom 变化时派发事件（post flush 等变换落到 DOM）
watch(
  () => [pan.x, pan.y, zoom.value],
  () => {
    // 监听者会立即反查画布缩放系数，须在派发前失效其缓存（否则拿到上一帧的系数）
    invalidateCanvasScaleCache()
    // pan 纯平移不影响高度，所以仅 zoom 变化需重测
    window.dispatchEvent(new CustomEvent('Mindrizzle:canvas-transform', { detail: { zoom: zoom.value } }))
    // zoom 变化会让子组件用冻结的 prop 重写 transform，所以拖拽中须在渲染落定后补写命令式位置
    if (customDrag.active) syncDragDom()
  },
  { flush: 'post' },
)

// zoom 会同步放大 translate，所以平移量除以 zoom；屏幕位置 = content*zoom + pan + origin
const canvasStyle = computed<CSSProperties>(() => ({
  zoom: zoom.value,
  transform: `translate(${Math.round((pan.x + origin.x) / zoom.value)}px, ${Math.round((pan.y + origin.y) / zoom.value)}px)`,
  transformOrigin: '0 0',
}))
// #endregion 缩放与画布变换

// 点阵需随 pan 平移且附着内容网格，所以周期取 tile*zoom，按 (pan+origin+extend) 对周期取余对齐原点
// #region 点阵背景与容器样式
const DOTS_TILE = 24
const dotsStyle = computed<CSSProperties>(() => {
  const period = DOTS_TILE * zoom.value
  const extend = period
  const mod = (v: number) => ((v % period) + period) % period
  return {
    top: `${-extend}px`,
    left: `${-extend}px`,
    right: `${-extend}px`,
    bottom: `${-extend}px`,
    backgroundSize: `${period}px ${period}px`,
    transform: `translate3d(${mod(pan.x + origin.x + extend)}px, ${mod(pan.y + origin.y + extend)}px, 0)`,
  }
})

const containerStyle = computed<CSSProperties>(() => ({
  // scoped CSS 的 min-height:0 在 v-sheet 上未生效，所以 inline 强制允许收缩（否则溢出处竖向滚动条）
  minHeight: '0',
  '--canvas-zoom': zoom.value,
}))
// #endregion 点阵背景与容器样式

// 块被拖到视口边缘时按距边缘距离驱动每帧自动平移
// #region 自动平移
const AUTOPAN_EDGE = 32
// 每帧 8px 易被感知为突然滚动，所以降为 6px
const AUTOPAN_MAX = 6
const autoPan = reactive({ active: false })
const lastMouse = { x: 0, y: 0 }
// 箭头需按方向角定位，所以用响应式鼠标屏幕坐标（lastMouse 仅供 autoPan）
const mouseScreen = ref({ x: -9999, y: -9999 })

const updateMousePos = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  const isCanvasTarget = target.closest?.('.canvas-container') === canvasContainerRef.value
  const hasActivePointerSession = selectionState.active || customDrag.active || !!resizeSession || panSession.active
  if (!isCanvasTarget && !hasActivePointerSession) return
  lastMouse.x = e.clientX
  lastMouse.y = e.clientY
  mouseScreen.value = { x: e.clientX, y: e.clientY }
  // 交互中指针不会落在块间连接点，所以清空曲别针避免干扰拖拽
  if (hasActivePointerSession) {
    if (nearClipKey.value) nearClipKey.value = null
    return
  }
  updateNearClip(e.clientX, e.clientY)
}

// 往调小方向滚会让块达钳制后偏离鼠标，所以按被拖边过滤；该轴已钳制则整轴禁滚
const restrictResizeAutoPan = (vx: number, vy: number): { vx: number; vy: number } => {
  const rs = resizeSession
  if (!rs) return { vx, vy }
  const item = state.items.find((it) => it.id === rs.itemId)
  if (!item) return { vx, vy }
  const handle = rs.handle
  const c = constraintsOf(item)
  const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
  const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
  // 组件已按 min/max 钳制 lastBase，所以带 0.5 容差防浮点抖动
  const wClamped = rs.lastBase.w <= minW + 0.5 || (maxW != null && rs.lastBase.w >= maxW - 0.5)
  const hClamped = rs.lastBase.h <= minH + 0.5 || (maxH != null && rs.lastBase.h >= maxH - 0.5)
  // 对角线手柄含两方向，所以水平按 r/l、垂直按 b/t 分别处理
  if (vx) {
    if (handle.includes('r') && (vx > 0 || wClamped)) vx = 0
    else if (handle.includes('l') && (vx < 0 || wClamped)) vx = 0
  }
  if (vy) {
    if (handle.includes('b') && (vy > 0 || hClamped)) vy = 0
    else if (handle.includes('t') && (vy < 0 || hClamped)) vy = 0
  }
  return { vx, vy }
}

// 提取鼠标距视口边缘的速度，供 tick 滚动与 resize 联结传播判定复用
const autoPanVelocity = (): { vx: number; vy: number } => {
  // 每帧调用会强制 reflow，所以用缓存的容器矩形
  const r = viewRect.value
  if (!r) return { vx: 0, vy: 0 }
  let vx = 0
  let vy = 0
  if (lastMouse.x < r.left + AUTOPAN_EDGE) vx = Math.min(r.left + AUTOPAN_EDGE - lastMouse.x, AUTOPAN_MAX)
  else if (lastMouse.x > r.right - AUTOPAN_EDGE) vx = -Math.min(lastMouse.x - (r.right - AUTOPAN_EDGE), AUTOPAN_MAX)
  if (lastMouse.y < r.top + AUTOPAN_EDGE) vy = Math.min(r.top + AUTOPAN_EDGE - lastMouse.y, AUTOPAN_MAX)
  else if (lastMouse.y > r.bottom - AUTOPAN_EDGE) vy = -Math.min(lastMouse.y - (r.bottom - AUTOPAN_EDGE), AUTOPAN_MAX)
  return { vx, vy }
}

// resize 时按被拖方向限制滚动速度
const restrictedPanVelocity = () => {
  const { vx, vy } = autoPanVelocity()
  return restrictResizeAutoPan(vx, vy)
}

// zoom≠1 时 pan 与块补偿取整无法抵消会长期漂移，所以用浮点残差累加器跨整补偿
const panCompAcc = reactive({ x: 0, y: 0 })

const autoPanTick = (frame: number) => {
  if (!autoPan.active) return
  const targetId = richTextDropTargetId.value
  const target = targetId ? richTextTargetForFrame(targetId, frame) : null
  const viewport = viewRect.value
  const pointer = target && viewport ? screenToContent(canvasTransform(), viewport, lastMouse.x, lastMouse.y) : null
  // 块完全可见时块内滚动与画布平移会互相拉扯，所以只在块未完全显示时平移画布（commit 767ea68 规则）
  const shouldPrioritizeRichText = !!target && !!pointer &&
    isTargetVisibleForFrame(target.pmEl, frame) && isPointerInsideRichText(target, pointer)
  const { vx: rx, vy: ry } = restrictedPanVelocity()
  if (!shouldPrioritizeRichText && (rx !== 0 || ry !== 0)) {
    // pan 是外部像素平移，按视口像素直接累加
    const sx = mobileMode.value ? 0 : Math.round(rx)
    const sy = Math.round(ry)
    if (!mobileMode.value) pan.x += sx
    pan.y += sy
    // 块屏幕位置 = 块坐标*z + pan，所以需补偿被拖块坐标（移动端锁水平只补偿竖向）
    panCompAcc.x += mobileMode.value ? 0 : -sx / zoom.value
    panCompAcc.y += -sy / zoom.value
    const compX = Math.round(panCompAcc.x)
    const compY = Math.round(panCompAcc.y)
    panCompAcc.x -= compX
    panCompAcc.y -= compY
    // 框选等场景无被拖块，所以仅 customDrag.active 时补偿，避免残留块被误移动
    if (customDrag.active) {
      customDragItems.forEach((dragTarget) => {
        const layout = layoutOf(dragTarget)
        if (!mobileMode.value) layout.x += compX
        layout.y += compY
      })
      richTextDropTargetId.value = findRichTextDropTarget()
      // 鼠标可能停住、applyCustomDrag 不跑，所以补偿后必须在此同步 DOM
      flushDragLayout()
    }
    // resize 时被拖块坐标受组件控制，所以按基准矩形 + 相对起始 pan 位移重算，使手柄跟随鼠标
    compensateResizeAutoPan()
    // 框选时无 mousemove 驱动，所以用最近鼠标位置每帧刷新选框
    if (selectionState.active) updateSelectionAt(lastMouse.x, lastMouse.y)
  }
  if (customDrag.active) updateRichTextDrop(frame)
  requestAnimationFrame(autoPanTick)
}

const startAutoPan = () => {
  if (autoPan.active) return
  autoPan.active = true
  requestAnimationFrame(autoPanTick)
}

const stopAutoPan = () => {
  autoPan.active = false
  panCompAcc.x = 0
  panCompAcc.y = 0
}
// #endregion 自动平移

// #region 手动平移（右键拖拽）
const startPan = (e: MouseEvent) => {
  // 任意位置右键都要能平移，所以不依赖 Vue 的 .right 修饰符
  if (e.button !== 2) return
  e.preventDefault()
  panSession.active = true
  panSession.startClientX = e.clientX
  panSession.startClientY = e.clientY
  panSession.startPanX = pan.x
  panSession.startPanY = pan.y
  isPanning.value = true
}

// mousedown 捕获阶段读 e.buttons 不可靠，所以单独跟踪左键按下
let leftButtonDown = false
const trackLeftButtonDown = (e: MouseEvent) => {
  if (e.button === 0) leftButtonDown = true
}
const trackLeftButtonUp = () => {
  leftButtonDown = false
}

// 容器监听会随重挂载失效且编辑器会拦截右键，所以在 window 捕获阶段统一处理
const onGlobalMouseDownCapture = (e: MouseEvent) => {
  if (e.button !== 2) return
  if (!(e.target as HTMLElement).closest?.('.canvas-container')) return
  if (customDrag.active || resizeSession || selectionState.active || leftButtonDown) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  startPan(e)
  e.stopPropagation()
}

// ProseMirror 会 stopPropagation 拦截右键，所以在捕获阶段拦截
const handleCanvasMouseDownCapture = (e: MouseEvent) => {
  if (e.button !== 2) return
  // 左键会话进行中按右键会干扰操作，所以忽略右键
  if (customDrag.active || resizeSession || selectionState.active || leftButtonDown) return
  startPan(e)
  e.stopPropagation()
}

// 逐事件处理会堆积无效更新（触发逐编辑器重算），所以用 rAF 合并到每帧一次
let panRafId = 0
let panTargetX = 0
let panTargetY = 0
const updatePan = (e: MouseEvent) => {
  if (!panSession.active) return
  // .canvas 的 translate 不受 scale 影响，所以 pan 按视口像素直接累加
  panTargetX = panSession.startPanX + (e.clientX - panSession.startClientX)
  panTargetY = panSession.startPanY + (e.clientY - panSession.startClientY)
  if (panRafId) return
  panRafId = requestAnimationFrame(applyPan)
}
const applyPan = () => {
  panRafId = 0
  if (!panSession.active) return
  // 亚像素平移会致界面模糊，所以取整；移动端锁水平
  pan.x = mobileMode.value ? 0 : Math.round(panTargetX)
  pan.y = Math.round(panTargetY)
}

const stopPan = () => {
  if (panRafId) {
    cancelAnimationFrame(panRafId)
    panRafId = 0
  }
  if (!panSession.active) return
  panSession.active = false
  isPanning.value = false
  maybeRebaseOrigin()
}

// 右键拖拽会弹原生菜单，所以窗口级禁用
const preventContextMenu = (e: Event) => e.preventDefault()

// block-handle 拖段落时需画布自平移，所以监听 useBlockDrag 派发的事件
const onCanvasPanEvent = (e: Event) => {
  const detail = (e as CustomEvent<{ dx?: number; dy?: number }>).detail
  if (!detail) return
  const dx = Number(detail.dx) || 0
  const dy = Number(detail.dy) || 0
  if (dx === 0 && dy === 0) return
  if (!mobileMode.value) pan.x += Math.round(dx)
  pan.y += Math.round(dy)
}
// #endregion 手动平移（右键拖拽）

// #region 框选状态
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
    left: `${roundToPx(x)}px`,
    top: `${roundToPx(y)}px`,
    width: `${roundToPx(w)}px`,
    height: `${roundToPx(h)}px`,
  }
})
// #endregion 框选状态

// #region 组件数据读写
// 逐次渲染返回新 props/回调对象会让子组件判定变更而逐个重渲染，所以按块缓存、值全等时复用
const componentPropCache = new WeakMap<CanvasItem, Record<string, any>>()
const componentRefHandlers = new WeakMap<CanvasItem, (el: unknown) => void>()
const autoHeightHandlers = new WeakMap<CanvasItem, (v: boolean) => void>()

const componentRefOf = (item: CanvasItem) => {
  const cached = componentRefHandlers.get(item)
  if (cached) return cached
  const handler = (el: unknown) => setComponentRef(item.id, el)
  componentRefHandlers.set(item, handler)
  return handler
}

const autoHeightHandlerOf = (item: CanvasItem) => {
  const cached = autoHeightHandlers.get(item)
  if (cached) return cached
  const handler = (v: boolean) => setAutoHeight(item, v)
  autoHeightHandlers.set(item, handler)
  return handler
}

const stableProps = (item: CanvasItem, props: Record<string, any>) => {
  const cached = componentPropCache.get(item)
  if (cached) {
    const keys = Object.keys(props)
    if (keys.length === Object.keys(cached).length && keys.every((key) => cached[key] === props[key])) return cached
  }
  componentPropCache.set(item, props)
  return props
}

const getComponentProps = (item: CanvasItem) => {
  if (item.component === 'RichTextEditor') {
    const cfg = item.config as RichTextConfig
    return stableProps(item, {
      doc: cfg.content,
      compact: mobileMode.value,
      autoHeight: cfg.autoHeight === true,
      readOnly: !isEditMode.value,
      'onUpdate:autoHeight': autoHeightHandlerOf(item),
    })
  }
  if (item.component === 'EditableCodeBlock') {
    const cfg = item.config as CodeBlockConfig
    return stableProps(item, {
      modelValue: cfg.code,
      language: cfg.language,
      readOnly: !isEditMode.value,
    })
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
// #endregion 组件数据读写

// 接触段要融合、露出段保留边框，所以为每块生成接触段同色遮罩（块内相对坐标）
// #region 贴合遮罩与圆角
interface EdgeMask {
  side: 'l' | 'r' | 't' | 'b'
  start: number
  len: number
}
const EDGE_TOL = 1
// 逐帧重算 O(N²) 成本高，所以改为显式缓存：交互期间冻结、收尾按最终布局刷新
const computeEdgeMasks = (): Record<string, EdgeMask[]> => {
  const map: Record<string, EdgeMask[]> = {}
  const items = state.items
  items.forEach((it) => { map[it.id] = [] })
  for (const a of items) {
    const ra = layoutOf(a)
    for (const b of items) {
      if (a.id === b.id) continue
      const rb = layoutOf(b)
      const yOverlap = Math.max(ra.y, rb.y) < Math.min(ra.y + ra.h, rb.y + rb.h)
      const xOverlap = Math.max(ra.x, rb.x) < Math.min(ra.x + ra.w, rb.x + rb.w)
      if (yOverlap && Math.abs(rb.x + rb.w - ra.x) <= EDGE_TOL) {
        const y0 = Math.max(ra.y, rb.y)
        const len = Math.min(ra.y + ra.h, rb.y + rb.h) - y0
        if (len > 0) {
          map[a.id].push({ side: 'l', start: y0 - ra.y, len })
          map[b.id].push({ side: 'r', start: y0 - rb.y, len })
        }
      }
      if (xOverlap && Math.abs(rb.y + rb.h - ra.y) <= EDGE_TOL) {
        const x0 = Math.max(ra.x, rb.x)
        const len = Math.min(ra.x + ra.w, rb.x + rb.w) - x0
        if (len > 0) {
          map[a.id].push({ side: 't', start: x0 - ra.x, len })
          map[b.id].push({ side: 'b', start: x0 - rb.x, len })
        }
      }
    }
  }
  return map
}
const edgeMasksMap = shallowRef<Record<string, EdgeMask[]>>({})
const masksOf = (id: string): EdgeMask[] => edgeMasksMap.value[id] ?? []
// 遮罩相对 padding box 定位，所以向外偏 1px 覆盖 border
const maskStyle = (m: EdgeMask): CSSProperties => {
  const base: CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 16,
  }
  // 接触段需提示可分离，所以在 surface 底色上间隔画淡灰虚线盖住实线 border
  const dashH = `repeating-linear-gradient(90deg, rgb(var(--v-theme-surface)) 0 4px, rgba(var(--v-theme-on-surface), 0.35) 4px 6px, rgb(var(--v-theme-surface)) 6px 8px)`
  const dashV = `repeating-linear-gradient(180deg, rgb(var(--v-theme-surface)) 0 4px, rgba(var(--v-theme-on-surface), 0.35) 4px 6px, rgb(var(--v-theme-surface)) 6px 8px)`
  // 右端会溢出盖住相邻垂直边框，所以长度缩 len-2，使贴合处边框连贯
  const span = Math.max(m.len - 2, 0)
  if (m.side === 'l') return { ...base, left: '-1px', top: `${m.start}px`, width: '1px', height: `${span}px`, background: dashV }
  if (m.side === 'r') return { ...base, right: '-1px', top: `${m.start}px`, width: '1px', height: `${span}px`, background: dashV }
  if (m.side === 't') return { ...base, top: '-1px', left: `${m.start}px`, height: '1px', width: `${span}px`, background: dashH }
  return { ...base, bottom: '-1px', left: `${m.start}px`, height: '1px', width: `${span}px`, background: dashH }
}

// 保留圆角会在接触边两端露弧形缺口，所以接触角归零圆角
const ROUNDED = 4
const computeCornerHits = (): Record<string, { tl: boolean; tr: boolean; bl: boolean; br: boolean }> => {
  const map: Record<string, { tl: boolean; tr: boolean; bl: boolean; br: boolean }> = {}
  const items = state.items
  items.forEach((it) => { map[it.id] = { tl: false, tr: false, bl: false, br: false } })
  items.forEach((it) => {
    const { w, h } = layoutOf(it)
    ;(edgeMasksMap.value[it.id] ?? []).forEach((m) => {
      const endHit = m.start + m.len
      if (m.side === 'l') {
        if (m.start <= EDGE_TOL) map[it.id].tl = true
        if (endHit >= h - EDGE_TOL) map[it.id].bl = true
      } else if (m.side === 'r') {
        if (m.start <= EDGE_TOL) map[it.id].tr = true
        if (endHit >= h - EDGE_TOL) map[it.id].br = true
      } else if (m.side === 't') {
        if (m.start <= EDGE_TOL) map[it.id].tl = true
        if (endHit >= w - EDGE_TOL) map[it.id].tr = true
      } else {
        if (m.start <= EDGE_TOL) map[it.id].bl = true
        if (endHit >= w - EDGE_TOL) map[it.id].br = true
      }
    })
  })
  return map
}
const cornerHitsMap = shallowRef<Record<string, { tl: boolean; tr: boolean; bl: boolean; br: boolean }>>({})
const cornerStyleOf = (id: string): CSSProperties => {
  const c = cornerHitsMap.value[id]
  if (!c) return {}
  const r = (hit: boolean) => (hit ? 0 : ROUNDED)
  const radius = `${r(c.tl)}px ${r(c.tr)}px ${r(c.br)}px ${r(c.bl)}px`
  if (radius === `${ROUNDED}px ${ROUNDED}px ${ROUNDED}px ${ROUNDED}px`) return {}
  return { borderRadius: radius }
}

// 遮罩/圆角/曲别针候选均由 layout 推导且含 O(N²) 计算，所以只在增删块/布局落定/交互收尾时调用
const recomputeMasks = () => {
  edgeMasksMap.value = computeEdgeMasks()
  cornerHitsMap.value = computeCornerHits()
  paperclipCandidates.value = computePaperclipCandidates()
}

// autoHeight 逐字符改高、O(N²) 刷新会卡输入，所以高频路径合并到每帧一次
let geometryRafId = 0
const scheduleGeometryRefresh = () => {
  if (geometryRafId) return
  geometryRafId = requestAnimationFrame(() => {
    geometryRafId = 0
    recomputeMasks()
  })
}
// #endregion 贴合遮罩与圆角

// 块贴近视口顶部时上方放不下手柄，所以按块视觉位置决定放上/下方
// #region 手柄与描边样式
const HANDLE_HEIGHT = 28
const handlePlacementOf = (item: CanvasItem): 'top' | 'bottom' =>
  visualY(layoutOf(item).y) < Math.round(HANDLE_HEIGHT * zoom.value) ? 'bottom' : 'top'

const handleBarStyle = (item: CanvasItem): CSSProperties => {
  const layout = layoutOf(item)
  // 拖拽中 handlePlacementOf 会切换放置导致手柄与块分离，所以拖拽期间锁定 placementLocked
  const dragging = customDrag.active && !!customDragGroup[item.id]
  const bottom = dragging ? customDrag.placementLocked : handlePlacementOf(item) === 'bottom'
  // round(y*zoom) 不一致会露 1px 缝隙，所以分别取整使手柄贴齐块视觉边缘
  const handleTop = bottom
    ? roundToPx(layout.y + layout.h)
    : roundToPx(layout.y) - roundToPx(HANDLE_HEIGHT)
  return {
    position: 'absolute',
    top: `${handleTop}px`,
    left: `${roundToPx(layout.x + 10)}px`,
    height: `${roundToPx(HANDLE_HEIGHT)}px`,
    // 手柄脱离块内层叠上下文，所以置 Z_LAYER.dragHandle 保证高于选中块与描边环
    zIndex: Z_LAYER.dragHandle,
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'grab',
    whiteSpace: 'nowrap',
    // 内联 transform 会压掉 transition 滑出动画，所以改用 CSS 变量 --handle-y/--handle-slide 组合进动画
    '--handle-y': '0px',
    '--handle-slide': `${bottom ? -HANDLE_HEIGHT : HANDLE_HEIGHT}px`,
  }
}

// 设置栏与拖拽栏同放置逻辑，显示在块右上角
const SIDE_SETTINGS_WIDTH = 28
const SIDE_SETTINGS_MARGIN = 8
const sideSettingsStyle = (item: CanvasItem): CSSProperties => {
  const l = layoutOf(item)
  const bottom = handlePlacementOf(item) === 'bottom'
  const top = bottom ? roundToPx(l.y + l.h) : roundToPx(l.y) - roundToPx(HANDLE_HEIGHT)
  return {
    position: 'absolute',
    top: `${top}px`,
    left: `${roundToPx(l.x + l.w) - roundToPx(SIDE_SETTINGS_WIDTH) - roundToPx(SIDE_SETTINGS_MARGIN)}px`,
    zIndex: Z_LAYER.dragHandle,
  }
}

// 描边环相对块边缘外扩 2px
const OUTLINE_PX = 2
const selectedOutlineStyle = (item: CanvasItem): CSSProperties => {
  const l = layoutOf(item)
  // 归属块拖拽栏需盖住别的块高亮又不遮断自己，所以其描边环用 outline（1002）
  const zIndex = outlineOwnerId.value === item.id ? Z_LAYER.outline : Z_LAYER.dragHandle - 1
  return {
    left: `${roundToPx(l.x) - roundToPx(OUTLINE_PX)}px`,
    top: `${roundToPx(l.y) - roundToPx(OUTLINE_PX)}px`,
    width: `${roundToPx(l.w) + roundToPx(OUTLINE_PX * 2)}px`,
    height: `${roundToPx(l.h) + roundToPx(OUTLINE_PX * 2)}px`,
    zIndex,
  }
}
// #endregion 手柄与描边样式

// #region 自定义拖拽与联结
const getSelectedItemIds = (item: CanvasItem) =>
  state.selectedIds.has(item.id) && state.selectedIds.size > 1
    ? Array.from(state.selectedIds)
    : [item.id]

// 块世界坐标 = 初始 + 鼠标位移 - (pan - panStart)，无需改 VDR 内部
const customDrag = reactive({
  active: false,
  startClientX: 0,
  startClientY: 0,
  panStartX: 0,
  panStartY: 0,
  placementLocked: false,
  sourceItemId: null as string | null,
  // 被拖块会盖住落点处的编辑器，所以拖拽中让其命中穿透
  draggingIds: new Set<string>(),
})
const richTextDropTargetId = ref<string | null>(null)
// 拖入富文本块的落点线与插入位置，随块内滚动每帧重算
interface RichTextDrop {
  id: string
  pos: number
  left: number
  right: number
  y: number
}
const richTextDrop = ref<RichTextDrop | null>(null)
// 逐帧赋新对象会让整棵画布重渲染，所以 content 坐标全等时不写（画布 pan 不影响该坐标系下的落点）
const setRichTextDrop = (next: RichTextDrop | null) => {
  const current = richTextDrop.value
  if (current === next) return
  if (current && next && current.id === next.id && current.pos === next.pos
    && current.left === next.left && current.right === next.right && current.y === next.y) return
  richTextDrop.value = next
}
const richTextDropLineStyle = computed<CSSProperties>(() => {
  const drop = richTextDrop.value
  if (!drop) return { display: 'none' }
  return {
    left: `${roundToPx(drop.left)}px`,
    width: `${Math.max(2 / zoom.value, roundToPx(drop.right - drop.left))}px`,
    transform: `translateY(${roundToPx(drop.y)}px)`,
  }
})
const richTextDropTargetStyle = computed<CSSProperties>(() => {
  const id = richTextDropTargetId.value
  const item = id ? state.items.find((target) => target.id === id) : null
  if (!item) return { display: 'none' }
  const layout = layoutOf(item)
  return {
    left: `${roundToPx(layout.x) - 4}px`,
    top: `${roundToPx(layout.y) - 4}px`,
    width: `${roundToPx(layout.w) + 8}px`,
    height: `${roundToPx(layout.h) + 8}px`,
  }
})
let customDragGroup: Record<string, { x: number; y: number }> = {}
// 逐帧遍历 state.items 会随块数卡顿，所以会话开始时缓存被拖块引用
let customDragItems = new Map<string, CanvasItem>()
// 曲别针粘贴的块对（key 为两 id 排序后 join），拖动一个时另一块跟着动
const linkedPairs = ref<Set<string>>(new Set())
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
const linkedNeighborMap = computed(() => {
  const neighbors = new Map<string, string[]>()
  linkedPairs.value.forEach((key) => {
    const [firstId, secondId] = key.split('|')
    const firstNeighbors = neighbors.get(firstId) ?? []
    const secondNeighbors = neighbors.get(secondId) ?? []
    firstNeighbors.push(secondId)
    secondNeighbors.push(firstId)
    neighbors.set(firstId, firstNeighbors)
    neighbors.set(secondId, secondNeighbors)
  })
  return neighbors
})
interface ConnectionPoint {
  x: number
  y: number
}

interface LinkedConnection {
  key: string
  start: ConnectionPoint
  end: ConnectionPoint
}

const roundConnectionPoint = (point: ConnectionPoint): ConnectionPoint => ({
  x: roundToVisual(zoom.value, point.x),
  y: roundToVisual(zoom.value, point.y),
})

const connectionPoints = (a: Rect, b: Rect): { start: ConnectionPoint; end: ConnectionPoint } => {
  const verticalGap = b.x - (a.x + a.w)
  const reverseVerticalGap = a.x - (b.x + b.w)
  const verticalOverlap = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2
  if (Math.abs(verticalGap) <= SNAP_TOLERANCE || Math.abs(reverseVerticalGap) <= SNAP_TOLERANCE) {
    const aOnLeft = Math.abs(verticalGap) <= SNAP_TOLERANCE
    const aX = aOnLeft ? a.x + a.w : a.x
    const bX = aOnLeft ? b.x : b.x + b.w
    return { start: { x: aX, y: verticalOverlap }, end: { x: bX, y: verticalOverlap } }
  }
  const horizontalGap = b.y - (a.y + a.h)
  const reverseHorizontalGap = a.y - (b.y + b.h)
  const horizontalOverlap = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2
  if (Math.abs(horizontalGap) <= SNAP_TOLERANCE || Math.abs(reverseHorizontalGap) <= SNAP_TOLERANCE) {
    const aOnTop = Math.abs(horizontalGap) <= SNAP_TOLERANCE
    const aY = aOnTop ? a.y + a.h : a.y
    const bY = aOnTop ? b.y : b.y + b.h
    return { start: { x: horizontalOverlap, y: aY }, end: { x: horizontalOverlap, y: bY } }
  }
  return {
    start: { x: a.x + a.w / 2, y: a.y + a.h / 2 },
    end: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
  }
}

// 同轴相邻的线分别渲染会在接口处断点，所以合并为一条连续线
interface ConnSegment {
  horizontal: boolean
  axis: number
  from: number
  to: number
}

const mergeConnSegments = (segments: ConnSegment[]): LinkedConnection[] => {
  const groups = new Map<string, ConnSegment[]>()
  segments.forEach((seg) => {
    const groupKey = `${seg.horizontal ? 'h' : 'v'}:${seg.axis}`
    const group = groups.get(groupKey)
    if (group) group.push(seg)
    else groups.set(groupKey, [seg])
  })
  const merged: LinkedConnection[] = []
  groups.forEach((group) => {
    group.sort((a, b) => a.from - b.from)
    let current = { ...group[0] }
    for (let i = 1; i < group.length; i++) {
      const next = group[i]
      // 贴合/微缝都算连续，所以间隔小于容差视为同一共享边缘
      if (next.from - current.to <= SNAP_TOLERANCE) current.to = Math.max(current.to, next.to)
      else {
        merged.push(toConnection(current))
        current = { ...next }
      }
    }
    merged.push(toConnection(current))
  })
  return merged
}

const toConnection = (seg: ConnSegment): LinkedConnection => {
  const key = `${seg.horizontal ? 'h' : 'v'}:${seg.axis}:${seg.from}-${seg.to}`
  if (seg.horizontal) {
    return { key, start: { x: seg.from, y: seg.axis }, end: { x: seg.to, y: seg.axis } }
  }
  return { key, start: { x: seg.axis, y: seg.from }, end: { x: seg.axis, y: seg.to } }
}

// layout 已非响应式，所以显式订阅版本号，使块移动后联结线重算
const linkedConnections = computed<LinkedConnection[]>(() => {
  void layoutVersion.value
  const itemMap = new Map(state.items.map((item) => [item.id, item]))
  const segments: ConnSegment[] = []
  linkedPairs.value.forEach((key) => {
    const [startId, endId] = key.split('|')
    const startItem = itemMap.get(startId)
    const endItem = itemMap.get(endId)
    if (!startItem || !endItem) return
    const startRect = layoutOf(startItem)
    const endRect = layoutOf(endItem)
    if (!isAdjacent(startRect, endRect)) return
    const points = connectionPoints(startRect, endRect)
    const start = roundConnectionPoint(points.start)
    const end = roundConnectionPoint(points.end)
    if (start.y === end.y) {
      segments.push({ horizontal: true, axis: start.y, from: Math.min(start.x, end.x), to: Math.max(start.x, end.x) })
    } else {
      segments.push({ horizontal: false, axis: start.x, from: Math.min(start.y, end.y), to: Math.max(start.y, end.y) })
    }
  })
  return mergeConnSegments(segments)
})

// 半像素栅格化会发虚，所以色条起点与长度取整
const connectionSegmentStyle = (line: LinkedConnection): CSSProperties => {
  const horizontal = line.start.y === line.end.y
  if (horizontal) {
    return {
      left: `${roundToPx(Math.min(line.start.x, line.end.x))}px`,
      top: `${roundToPx(line.start.y - 1)}px`,
      width: `${roundToPx(Math.abs(line.end.x - line.start.x))}px`,
      height: `${roundToPx(2)}px`,
    }
  }
  return {
    left: `${roundToPx(line.start.x - 1)}px`,
    top: `${roundToPx(Math.min(line.start.y, line.end.y))}px`,
    width: `${roundToPx(2)}px`,
    height: `${roundToPx(Math.abs(line.end.y - line.start.y))}px`,
  }
}

const collectLinkedIds = (rootId: string): Set<string> => {
  const out = new Set<string>()
  const queue = [rootId]
  while (queue.length) {
    const id = queue.pop()!
    if (out.has(id)) continue
    out.add(id)
    linkedNeighborMap.value.get(id)?.forEach((neighborId) => {
      if (!out.has(neighborId)) queue.push(neighborId)
    })
  }
  return out
}
const toggleLink = (a: string, b: string) => {
  const key = pairKey(a, b)
  const next = new Set(linkedPairs.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  linkedPairs.value = next
}

// 只加 body 类要等下次 state-change 才收起，所以向所有编辑器派发块外指针事件立即清 hover
const hideAllBlockHandles = () => {
  const emptyPoint = { bubbles: true, clientX: -9999, clientY: -9999, pointerId: 1 }
  document.querySelectorAll<HTMLElement>('.ProseMirror').forEach((dom) => {
    dom.dispatchEvent(new PointerEvent('pointermove', emptyPoint))
    dom.dispatchEvent(new PointerEvent('pointerout', emptyPoint))
  })
}

// 拖拽期 layout 不触发渲染，所以块本体与跟随浮层（描边环/拖拽栏/设置栏）必须命令式搬位置
interface DragDomEntry {
  wrapper: HTMLElement | null
  outline: HTMLElement | null
}
let dragDom = new Map<string, DragDomEntry>()
let dragHandleEl: HTMLElement | null = null
let dragSettingsEl: HTMLElement | null = null
// 联结线等由 layout 推导的浮层只走响应式路径，所以存在链接时退回逐帧重渲染
let dragNeedsRender = false

const applyElStyle = (el: HTMLElement, style: CSSProperties) => { Object.assign(el.style, style) }

// 圆整规则要与 ResizeBox.boxStyle 一致，否则松手瞬间会跳位
const translateOf = (layout: Rect) => `translate(${roundToPx(layout.x)}px, ${roundToPx(layout.y)}px)`

const indexByDataId = (root: HTMLElement, selector: string) => {
  const map = new Map<string, HTMLElement>()
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const id = el.dataset.id
    if (id) map.set(id, el)
  })
  return map
}

const cacheDragDom = () => {
  const canvas = canvasRef.value
  dragDom = new Map()
  dragHandleEl = null
  dragSettingsEl = null
  if (!canvas) return
  const wrappers = indexByDataId(canvas, '.drag-wrapper')
  const outlines = indexByDataId(canvas, '.selected-outline')
  const sourceId = customDrag.sourceItemId
  customDragItems.forEach((_, id) => {
    dragDom.set(id, { wrapper: wrappers.get(id) ?? null, outline: outlines.get(id) ?? null })
  })
  dragHandleEl = sourceId ? indexByDataId(canvas, '.floating-handle').get(sourceId) ?? null : null
  dragSettingsEl = sourceId ? indexByDataId(canvas, '.side-settings').get(sourceId) ?? null : null
}

const syncDragDom = () => {
  customDragItems.forEach((item, id) => {
    const dom = dragDom.get(id)
    if (!dom) return
    if (dom.wrapper) dom.wrapper.style.transform = translateOf(layoutOf(item))
    if (dom.outline) applyElStyle(dom.outline, selectedOutlineStyle(item))
  })
  const source = customDrag.sourceItemId ? customDragItems.get(customDrag.sourceItemId) : null
  if (!source) return
  if (dragHandleEl) applyElStyle(dragHandleEl, handleBarStyle(source))
  if (dragSettingsEl) applyElStyle(dragSettingsEl, sideSettingsStyle(source))
}

const clearDragDom = () => {
  dragDom = new Map()
  dragHandleEl = null
  dragSettingsEl = null
}

// 拖拽中不递增版本号（靠命令式写 DOM），所以 layout 变更后必须显式同步一次
const flushDragLayout = () => {
  if (dragNeedsRender) markLayoutDirty()
  syncDragDom()
}

const startCustomDrag = (item: CanvasItem, e: MouseEvent) => {
  if (e.button !== 0) return
  if (!isEditMode.value) return
  selectForDrag(item.id, e)
  customDrag.active = true
  customDrag.sourceItemId = item.id
  customDrag.startClientX = e.clientX
  customDrag.startClientY = e.clientY
  // 落点解析由 rAF 驱动、按下未移动也会读坐标，所以以按下点初始化
  customDragLastX = e.clientX
  customDragLastY = e.clientY
  customDrag.panStartX = pan.x
  customDrag.panStartY = pan.y
  customDrag.placementLocked = handlePlacementOf(item) === 'bottom'
  customDragGroup = {}
  customDragItems = new Map()
  getSelectedItemIds(item).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (target) {
      customDragGroup[id] = { x: layoutOf(target).x, y: layoutOf(target).y }
      customDragItems.set(id, target)
    }
  })
  // 粘贴的块需随被拖块一起移动，所以把链接可达的块加入拖拽组（仅桌面端）
  if (!mobileMode.value) {
    collectLinkedIds(item.id).forEach((id) => {
      if (customDragGroup[id]) return
      const target = state.items.find((it) => it.id === id)
      if (target) {
        customDragGroup[id] = { x: layoutOf(target).x, y: layoutOf(target).y }
        customDragItems.set(id, target)
      }
    })
  }
  // 编辑器 hover 自解析在 zoom≠1 时会 stopPropagation，所以用捕获阶段监听
  window.addEventListener('pointermove', onCustomDragMove, true)
  window.addEventListener('pointerup', onCustomDragUp)
  // 拖拽期间 layout 不触发重渲染，所以块本体与跟随浮层靠命令式写 DOM，链接线等派生浮层退回逐帧重渲染
  dragNeedsRender = linkedPairs.value.size > 0
  cacheDragDom()
  window.addEventListener('mousemove', onCustomDragMove, true)
  window.addEventListener('mouseup', onCustomDragUp)
  customDrag.draggingIds = new Set(Object.keys(customDragGroup))
  e.preventDefault()
  document.body.classList.add('block-handle-dragging')
  // 只加 body 类要等下次 state-change 才收起，所以立即向所有编辑器派发块外指针事件
  hideAllBlockHandles()
  // 拖拽中块可能超出视口出现滚动条，所以临时锁 html/body 滚动
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  startAutoPan()
}

let customDragRafId = 0
let customDragLastX = 0
let customDragLastY = 0

const onCustomDragMove = (e: MouseEvent) => {
  if (!customDrag.active) return
  // hideAllBlockHandles 会派发 -9999 伪事件，所以不能当作指针位置
  if (!e.isTrusted) return
  customDragLastX = e.clientX
  customDragLastY = e.clientY
  if (customDragRafId) return
  customDragRafId = requestAnimationFrame(applyCustomDrag)
}

const findRichTextDropTarget = (): string | null => {
  const source = state.items.find((item) => item.id === customDrag.sourceItemId)
  const viewport = viewRect.value
  if (!source || !componentNodeOf(source) || !viewport) return null
  const sourceLayout = layoutOf(source)
  const sourceTopLeft = contentToScreen(canvasTransform(), viewport, sourceLayout.x, sourceLayout.y)
  const sourceBottomRight = contentToScreen(
    canvasTransform(), viewport, sourceLayout.x + sourceLayout.w, sourceLayout.y + sourceLayout.h,
  )
  for (const target of state.items) {
    if (target.id === source.id || target.component !== 'RichTextEditor') continue
    const targetLayout = layoutOf(target)
    const targetTopLeft = contentToScreen(canvasTransform(), viewport, targetLayout.x, targetLayout.y)
    const targetBottomRight = contentToScreen(
      canvasTransform(), viewport, targetLayout.x + targetLayout.w, targetLayout.y + targetLayout.h,
    )
    const overlapWidth = Math.min(sourceBottomRight.x, targetBottomRight.x) - Math.max(sourceTopLeft.x, targetTopLeft.x)
    const overlapHeight = Math.min(sourceBottomRight.y, targetBottomRight.y) - Math.max(sourceTopLeft.y, targetTopLeft.y)
    if (overlapWidth > 0 && overlapHeight > 0) return target.id
  }
  return null
}

// 块内滚动后落点会变，所以由 rAF 每帧重算；各浏览器 BCR 是否含 zoom 不一致，所以以目标块 DOM 矩形为参照反推 content 坐标
interface RichTextTarget {
  id: string
  resolveDropAtElement: (el: HTMLElement | null, preferBefore: boolean) => number | null
  scrollContent?: (deltaY: number) => void
  pmEl: HTMLElement
  blockRect: DOMRect
  blockLayout: Rect
  domScale: number
  pmRect: DOMRect
  scrollRect: DOMRect
}

const richTextTargetOf = (id: string): RichTextTarget | null => {
  const item = state.items.find((it) => it.id === id)
  const wrapper = document.querySelector<HTMLElement>(`.drag-wrapper[data-id="${id}"]`)
  const scroll = wrapper?.querySelector<HTMLElement>('.editor-scroll') ?? null
  const pm = wrapper?.querySelector<HTMLElement>('.ProseMirror') ?? null
  const { resolveDropAtElement, scrollContent } = componentRefs.value[id] ?? {}
  if (!item || !wrapper || !scroll || !pm || !resolveDropAtElement) return null
  const blockLayout = layoutOf(item)
  const blockRect = wrapper.getBoundingClientRect()
  return {
    id,
    resolveDropAtElement,
    scrollContent,
    pmEl: pm,
    blockRect,
    blockLayout,
    // 浏览器 BCR 是否含 zoom 不一致，所以用实测比例反推
    domScale: blockLayout.w > 0 && blockRect.width > 0 ? blockRect.width / blockLayout.w : 1,
    pmRect: pm.getBoundingClientRect(),
    scrollRect: scroll.getBoundingClientRect(),
  }
}

// autoPanTick 与 updateRichTextDrop 在同一 rAF 帧内会各自重测目标块（querySelector + 多次 BCR），所以按帧号缓存；帧号 0 表示帧外调用、须直测实时值
let rtTargetFrame = 0
let rtTargetId: string | null = null
let rtTargetValue: RichTextTarget | null = null
const richTextTargetForFrame = (id: string, frame: number): RichTextTarget | null => {
  if (frame > 0 && frame === rtTargetFrame && id === rtTargetId) return rtTargetValue
  rtTargetFrame = frame
  rtTargetId = id
  rtTargetValue = richTextTargetOf(id)
  return rtTargetValue
}

let rtVisibleFrame = 0
let rtVisibleEl: HTMLElement | null = null
let rtVisibleValue = false
const isTargetVisibleForFrame = (el: HTMLElement | null, frame: number): boolean => {
  if (frame > 0 && frame === rtVisibleFrame && el === rtVisibleEl) return rtVisibleValue
  rtVisibleFrame = frame
  rtVisibleEl = el
  rtVisibleValue = isFullyVisibleInCanvas(el)
  return rtVisibleValue
}

const domRectToContent = (target: RichTextTarget, rect: DOMRect) => ({
  left: target.blockLayout.x + (rect.left - target.blockRect.left) / target.domScale,
  right: target.blockLayout.x + (rect.right - target.blockRect.left) / target.domScale,
  top: target.blockLayout.y + (rect.top - target.blockRect.top) / target.domScale,
  bottom: target.blockLayout.y + (rect.bottom - target.blockRect.top) / target.domScale,
})

// 离块太远会一直滚，所以仅贴边带内按距离比例滚动（步进按视觉像素折算，各缩放手感一致）
const RT_SCROLL_EDGE = 40
const RT_SCROLL_MAX = 12
const isPointerInsideRichText = (target: RichTextTarget, point: Point): boolean => {
  const rect = domRectToContent(target, target.pmRect)
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

const autoScrollRichText = (target: RichTextTarget, point: Point, frame: number) => {
  if (!isTargetVisibleForFrame(target.pmEl, frame) || !isPointerInsideRichText(target, point)) return
  const { x, y } = point
  const area = domRectToContent(target, target.scrollRect)
  if (x < area.left || x > area.right) return
  const visualToContent = 1 / zoom.value
  const edge = RT_SCROLL_EDGE * visualToContent
  const above = area.top + edge - y
  const below = y - (area.bottom - edge)
  const distance = Math.max(above, below)
  if (distance <= 0 || distance > edge) return
  const step = Math.ceil((RT_SCROLL_MAX * visualToContent * distance) / edge)
  target.scrollContent?.(above > 0 ? -step : step)
}

// 命中元素上溯到 ProseMirror 的直系子级块元素
const blockElementAt = (el: HTMLElement | null, pmEl: HTMLElement) => {
  if (!el || !pmEl.contains(el)) return null
  let block: HTMLElement = el
  while (block.parentElement && block.parentElement !== pmEl) block = block.parentElement
  return block.parentElement === pmEl ? block : null
}

// gutter/空隙处命不中块，所以按鼠标纵向取最近顶层块作参照
const nearestBlockElement = (target: RichTextTarget, cy: number): HTMLElement | null => {
  let best: HTMLElement | null = null
  let bestDistance = Infinity
  for (const child of Array.from(target.pmEl.children)) {
    const el = child as HTMLElement
    const domRect = getVisibleBlockRect(el)
    if (!domRect) continue
    const rect = domRectToContent(target, domRect)
    if (cy >= rect.top && cy <= rect.bottom) return el
    const distance = cy < rect.top ? rect.top - cy : cy - rect.bottom
    if (distance < bestDistance) {
      bestDistance = distance
      best = el
    }
  }
  return best
}

// posAtCoords/coordsAtPos 混用 BCR 与鼠标坐标系、zoom 下必偏移，所以改用 elementFromPoint + posAtDOM
const resolveRichTextDrop = (target: RichTextTarget, point: Point, viewport: ViewportOrigin) => {
  const pm = domRectToContent(target, target.pmRect)
  const area = domRectToContent(target, target.scrollRect)
  const cx = clampVal(point.x, pm.left, pm.right)
  const cy = clampVal(point.y, Math.max(pm.top, area.top), Math.min(pm.bottom, area.bottom))
  const screen = contentToScreen(canvasTransform(), viewport, cx, cy)
  // gutter 处 pointer-events:none 无元素，所以再贴文本区左缘探一次
  const insideX = contentToScreen(canvasTransform(), viewport, pm.left, cy).x + 2
  const at = (x: number) => document.elementFromPoint(x, screen.y) as HTMLElement | null
  const hitEl = [at(screen.x), at(insideX)].find((el) => el && target.pmEl.contains(el)) ?? null
  const blockEl = blockElementAt(hitEl, target.pmEl) ?? nearestBlockElement(target, cy)
  if (!blockEl) return null
  const blockDomRect = getVisibleBlockRect(blockEl)
  if (!blockDomRect) return null
  const block = domRectToContent(target, blockDomRect)
  const preferBefore = cy < (block.top + block.bottom) / 2
  const pos = target.resolveDropAtElement(blockEl, preferBefore)
  if (pos == null) return null
  return {
    id: target.id,
    pos,
    left: pm.left,
    right: pm.right,
    y: preferBefore ? block.top : block.bottom,
  }
}

// 帧内块内可能已滚动，所以松手时按实时坐标重算落点
const resolveDropForTarget = (targetId: string, event?: MouseEvent) => {
  const viewport = viewRect.value
  const target = viewport ? richTextTargetOf(targetId) : null
  if (!viewport || !target) return null
  const point = screenToContent(canvasTransform(), viewport, event?.clientX ?? customDragLastX, event?.clientY ?? customDragLastY)
  return resolveRichTextDrop(target, point, viewport)
}

const updateRichTextDrop = (frame = 0) => {
  const viewport = viewRect.value
  const targetId = richTextDropTargetId.value
  const target = viewport && targetId ? richTextTargetForFrame(targetId, frame) : null
  if (!viewport || !target) {
    setRichTextDrop(null)
    return
  }
  const point = screenToContent(canvasTransform(), viewport, customDragLastX, customDragLastY)
  // 两者同时进行会让落点乱跳，所以块未完全显示时不滚块内内容
  const canScrollInside = isPointerInsideRichText(target, point) && isTargetVisibleForFrame(target.pmEl, frame)
  if (canScrollInside) autoScrollRichText(target, point, frame)
  setRichTextDrop(resolveRichTextDrop(target, point, viewport))
}

const applyCustomDrag = (frame: number) => {
  customDragRafId = 0
  if (!customDrag.active) return
  // 画布按 zoom 渲染，所以鼠标位移需除以 zoom
  const dx = (customDragLastX - customDrag.startClientX) / zoom.value
  const dy = (customDragLastY - customDrag.startClientY) / zoom.value
  const panDx = (pan.x - customDrag.panStartX) / zoom.value
  const panDy = (pan.y - customDrag.panStartY) / zoom.value
  customDragItems.forEach((target, id) => {
    const origin = customDragGroup[id]
    const layout = layoutOf(target)
    // 块屏幕位置需落在整数像素，所以取整
    layout.x = mobileMode.value ? origin.x : Math.round(origin.x + dx - panDx)
    layout.y = Math.round(origin.y + dy - panDy)
    if (!mobileMode.value) snapLayoutToOthers(target, layout)
  })
  richTextDropTargetId.value = findRichTextDropTarget()
  updateRichTextDrop(frame)
  flushDragLayout()
}

// 自定义拖拽绕过 VDR 的 snap，所以手动做边缘/中线对齐吸附
const SNAP_TOLERANCE = 10
const PAPERCLIP_PROXIMITY = 32
const snapLayoutToOthers = (target: CanvasItem, layout: Rect) => {
  const hasOverlap = state.items.some((other) => {
    if (other.id === target.id || customDragGroup[other.id]) return false
    const o = layoutOf(other)
    return layout.x < o.x + o.w && layout.x + layout.w > o.x && layout.y < o.y + o.h && layout.y + layout.h > o.y
  })
  if (hasOverlap) return

  const candidatesX: number[] = []
  const candidatesY: number[] = []
  state.items.forEach((other) => {
    if (other.id === target.id || customDragGroup[other.id]) return
    const o = layoutOf(other)
    candidatesX.push(
      o.x - layout.x, o.x + o.w - layout.x,
      o.x - (layout.x + layout.w), o.x + o.w - (layout.x + layout.w),
      (o.x + o.w / 2) - (layout.x + layout.w / 2),
    )
    candidatesY.push(
      o.y - layout.y, o.y + o.h - layout.y,
      o.y - (layout.y + layout.h), o.y + o.h - (layout.y + layout.h),
      (o.y + o.h / 2) - (layout.y + layout.h / 2),
    )
  })
  const nearest = (arr: number[]) => {
    let best = 0
    let bestAbs = Infinity
    arr.forEach((d) => {
      const abs = Math.abs(d)
      if (abs <= SNAP_TOLERANCE && abs < bestAbs) {
        bestAbs = abs
        best = d
      }
    })
    return best
  }
  layout.x += nearest(candidatesX)
  layout.y += nearest(candidatesY)
}

const isAdjacent = (a: Rect, b: Rect): boolean => {
  const hasVerticalOverlap = a.y < b.y + b.h && b.y < a.y + a.h
  const hasHorizontalOverlap = a.x < b.x + b.w && b.x < a.x + a.w
  const touchesVerticalEdge = Math.abs(a.x + a.w - b.x) <= SNAP_TOLERANCE ||
    Math.abs(b.x + b.w - a.x) <= SNAP_TOLERANCE
  const touchesHorizontalEdge = Math.abs(a.y + a.h - b.y) <= SNAP_TOLERANCE ||
    Math.abs(b.y + b.h - a.y) <= SNAP_TOLERANCE
  return (touchesVerticalEdge && hasVerticalOverlap) ||
    (touchesHorizontalEdge && hasHorizontalOverlap)
}

// 曲别针取连接线两端点的中点定位
const connectionPoint = (a: Rect, b: Rect): { x: number; y: number } => {
  const { start, end } = connectionPoints(a, b)
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
}

// 层级已在 zIndex.ts 固定，所以曲别针无需运行时降 z

// autoHeight 时块高由内容驱动，所以过滤垂直手柄
const isAutoHeight = (item: CanvasItem): boolean =>
  item.component === 'RichTextEditor' && (item.config as RichTextConfig).autoHeight === true

const setAutoHeight = (item: CanvasItem, v: boolean) => {
  if (item.component !== 'RichTextEditor') return
  ;(item.config as RichTextConfig).autoHeight = v
  // config 已非响应式，而手柄集合与子组件 props 依赖它，所以显式刷新
  markLayoutDirty()
}

// 每次渲染返回新数组会让 ResizeBox 判定 props 变更而重渲染，所以复用常量数组
const HANDLES_SIDE_ONLY = ['ml', 'mr']
const HANDLES_MOBILE = ['tm', 'bm']
const HANDLES_NO_TOP_MIDDLE = ['tl', 'tr', 'ml', 'mr', 'bl', 'bm', 'br']
const HANDLES_ALL = ['tl', 'tm', 'tr', 'ml', 'mr', 'bl', 'bm', 'br']

// 手柄已 Teleport 脱离 .drag-wrapper（CSS 隐藏规则失效），所以按 popup 显隐过滤 tm 手柄
const resizeHandlesOf = (item: CanvasItem): string[] => {
  if (isAutoHeight(item)) return HANDLES_SIDE_ONLY
  if (mobileMode.value) return HANDLES_MOBILE
  if (popupBlockId.value === item.id) return HANDLES_NO_TOP_MIDDLE
  return HANDLES_ALL
}

// 内联箭头回调逐次渲染都是新引用、会迫使 ResizeBox 重渲染，所以按块缓存稳定回调
interface ResizeCallbacks {
  start: (handle: string) => void
  resizing: (x: number, y: number, w: number, h: number) => void
  resizestop: (x: number, y: number, w: number, h: number) => void
}
const resizeCallbackCache = new WeakMap<CanvasItem, ResizeCallbacks>()
const resizeCallbacksOf = (item: CanvasItem): ResizeCallbacks => {
  const cached = resizeCallbackCache.get(item)
  if (cached) return cached
  const callbacks: ResizeCallbacks = {
    start: (handle) => onResizeStart(item, handle),
    resizing: (x, y, w, h) => onResizing(item, x, y, w, h),
    resizestop: (x, y, w, h) => onResizeStop(item, x, y, w, h),
  }
  resizeCallbackCache.set(item, callbacks)
  return callbacks
}

// 候选需两两判定相邻（O(N²)），所以与遮罩一致改为显式缓存，只在布局落定时刷新
interface PaperclipCandidate {
  key: string
  a: string
  b: string
  x: number
  y: number
  linked: boolean
}

// popup 上侧开启会盖住曲别针，所以此时清空
const paperclipCandidateOf = (first: CanvasItem, second: CanvasItem): PaperclipCandidate | null => {
  const key = pairKey(first.id, second.id)
  const linked = linkedPairs.value.has(key)
  const rectA = layoutOf(first)
  const rectB = layoutOf(second)
  if (!linked && !isAdjacent(rectA, rectB)) return null
  const pt = connectionPoint(rectA, rectB)
  return { key, a: first.id, b: second.id, x: pt.x, y: pt.y, linked }
}

const computePaperclipCandidates = (): PaperclipCandidate[] => {
  if (mobileMode.value || popupTopOpen.value) return []
  const out: PaperclipCandidate[] = []
  state.items.forEach((first, index) => {
    const row = state.items.slice(index + 1)
      .map((second) => paperclipCandidateOf(first, second))
      .filter((candidate): candidate is PaperclipCandidate => !!candidate)
    out.push(...row)
  })
  return out
}

const paperclipCandidates = shallowRef<PaperclipCandidate[]>([])

// 每帧对缓存候选判距记录最近命中 key，显隐经 v-show 切换
const nearClipKey = ref<string | null>(null)
const updateNearClip = (clientX: number, clientY: number) => {
  const cr = viewRect.value
  if (!cr) return
  let best: string | null = null
  let bestDist = Infinity
  paperclipCandidates.value.forEach((c) => {
    // 曲别针在 .canvas 内，所以屏幕位置需加 origin/pan/容器偏移
    const sx = c.x * zoom.value + origin.x + pan.x + cr.left
    const sy = c.y * zoom.value + origin.y + pan.y + cr.top
    const d = Math.hypot(sx - clientX, sy - clientY)
    if (d <= PAPERCLIP_PROXIMITY && d < bestDist) {
      bestDist = d
      best = c.key
    }
  })
  if (nearClipKey.value !== best) nearClipKey.value = best
}

// 块拖拽走自定义路径、VDR 冲突检测不触发，所以松开时自行检测重叠并回退
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

const componentNodeOf = (item: CanvasItem): { name: string; props: Record<string, any> } | null => {
  if (item.component !== 'EditableCodeBlock') return null
  const config = item.config as CodeBlockConfig
  return { name: 'CodeBlock', props: { modelValue: config.code, language: config.language } }
}

const insertDraggedComponent = (targetId: string, sourceId: string, pos: number | null): boolean => {
  const target = state.items.find((item) => item.id === targetId)
  const source = state.items.find((item) => item.id === sourceId)
  const component = source ? componentNodeOf(source) : null
  if (!target || !component) return false
  const commands = componentRefs.value[target.id]?.commands
  // 落点可能解析失败，所以无指示线时回退到按当前选区插入
  const inserted = (pos != null && commands?.insertVueComponentAt?.(pos, component.name, component.props))
    || !!commands?.insertVueComponent?.(component.name, component.props)
  if (!inserted) return false
  const removedIds = new Set([sourceId])
  state.items = state.items.filter((item) => !removedIds.has(item.id))
  state.selectedIds = new Set()
  delete componentRefs.value[sourceId]
  linkedPairs.value = new Set([...linkedPairs.value].filter((key) => {
    const [first, second] = key.split('|')
    return !removedIds.has(first) && !removedIds.has(second)
  }))
  return true
}

// 松手后浏览器会补发 click，所以打标记由紧随的 click 消费，避免拖拽组被收缩为单选
let dragJustFinished = false

const onCustomDragUp = (e?: MouseEvent) => {
  dragJustFinished = true
  const targetId = findRichTextDropTarget()
  const sourceId = customDrag.sourceItemId
  const drop = targetId ? resolveDropForTarget(targetId, e) : null
  const inserted = targetId && sourceId ? insertDraggedComponent(targetId, sourceId, drop?.pos ?? null) : false
  richTextDropTargetId.value = null
  setRichTextDrop(null)
  // 清空后 draggedIds 为空集，所以冲突检测须在清空 customDragGroup 前执行
  if (!inserted) resolveDragConflict()
  // props 未变时 Vue 会跳过 patch，所以回退/取整后的最终位置必须显式落回 DOM
  flushDragLayout()
  clearDragDom()
  customDrag.active = false
  customDrag.sourceItemId = null
  // 残留块会被框选自动滚动误补偿，所以结束即清空拖拽组
  customDragGroup = {}
  customDragItems = new Map()
  customDrag.draggingIds = new Set()
  if (customDragRafId) {
    cancelAnimationFrame(customDragRafId)
    customDragRafId = 0
  }
  window.removeEventListener('pointermove', onCustomDragMove, true)
  window.removeEventListener('pointerup', onCustomDragUp)
  window.removeEventListener('mousemove', onCustomDragMove, true)
  window.removeEventListener('mouseup', onCustomDragUp)
  stopAutoPan()
  document.body.classList.remove('block-handle-dragging')
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  maybeRebaseOrigin()
  recomputeMasks()
  markLayoutDirty()
}
// #endregion 自定义拖拽与联结

// resize 会话（坐标全为 content 世界坐标）
// #region 尺寸调整与联结传播
interface ResizeSession {
  itemId: string
  handle: string
  starts: Record<string, Rect>
  lastBase: Rect
  panStartX: number
  panStartY: number
}
let resizeSession: ResizeSession | null = null

// 自动滚动会让被拖块偏离鼠标，所以按基准矩形 + 相对起始 pan 位移补偿：被拖边钉屏、锚定边随画布滚
const applyPanCorrection = (
  base: Rect,
  handle: string,
  c: Required<ResizeConstraints>,
  dpX: number,
  dpY: number,
): Rect => {
  const out = { ...base }
  const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
  const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
  // 组件上报的 base 已按 min/max 钳制，所以带 0.5 容差防浮点抖动
  const wClamped = base.w <= minW + 0.5 || (maxW != null && base.w >= maxW - 0.5)
  const hClamped = base.h <= minH + 0.5 || (maxH != null && base.h >= maxH - 0.5)
  if (dpY && !hClamped) {
    // 拖 t 改 y+height、拖 b 改 height；补偿后按 min/max 钳制（锚定边保持 y+h 不变）
    if (handle.includes('t')) {
      const rawH = out.h + dpY
      const nh = clampVal(rawH, minH, maxH)
      out.y = out.y - dpY + (rawH - nh)
      out.h = nh
    } else {
      out.h = clampVal(out.h - dpY, minH, maxH)
    }
  }
  if (dpX && !wClamped) {
    if (handle.includes('l')) {
      const rawW = out.w + dpX
      const nw = clampVal(rawW, minW, maxW)
      out.x = out.x - dpX + (rawW - nw)
      out.w = nw
    } else {
      out.w = clampVal(out.w - dpX, minW, maxW)
    }
  }
  return out
}

// 按被拖边对齐其他块的边/中线，仅调被拖边、保持 min/max 钳制
const snapResizeEdges = (handle: string, rect: Rect, c: Required<ResizeConstraints>): Rect => {
  const out = { ...rect }
  const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
  const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
  const nearest = (cur: number, targets: number[]): number => {
    let best = 0
    let bestAbs = Infinity
    targets.forEach((t) => {
      const d = t - cur
      const abs = Math.abs(d)
      if (abs <= SNAP_TOLERANCE && abs < bestAbs) {
        bestAbs = abs
        best = d
      }
    })
    return best
  }
  const xs: number[] = []
  const ys: number[] = []
  state.items.forEach((other) => {
    if (other.id === resizeSession?.itemId) return
    const o = layoutOf(other)
    xs.push(o.x, o.x + o.w, o.x + o.w / 2)
    ys.push(o.y, o.y + o.h, o.y + o.h / 2)
  })
  if (handle.includes('r')) out.w = clampVal(out.w + nearest(out.x + out.w, xs), minW, maxW)
  if (handle.includes('l')) {
    const d = nearest(out.x, xs)
    if (d !== 0) {
      const nw = clampVal(out.w - d, minW, maxW)
      out.x = out.x + out.w - nw
      out.w = nw
    }
  }
  if (handle.includes('b')) out.h = clampVal(out.h + nearest(out.y + out.h, ys), minH, maxH)
  if (handle.includes('t')) {
    const d = nearest(out.y, ys)
    if (d !== 0) {
      const nh = clampVal(out.h - d, minH, maxH)
      out.y = out.y + out.h - nh
      out.h = nh
    }
  }
  return out
}

// autoPan 滚动时贴底联结块会被钉屏压缩，所以滚动期间冻结联结传播
const applyResizeLayout = (item: CanvasItem, propagate: boolean) => {
  const rs = resizeSession
  if (!rs) return
  const final = applyPanCorrection(
    rs.lastBase,
    rs.handle,
    constraintsOf(item),
    (pan.x - rs.panStartX) / zoom.value,
    (pan.y - rs.panStartY) / zoom.value,
  )
  const snapped = snapResizeEdges(rs.handle, final, constraintsOf(item))
  const layout = layoutOf(item)
  layout.x = Math.round(snapped.x)
  layout.y = Math.round(snapped.y)
  layout.w = Math.round(snapped.w)
  layout.h = Math.round(snapped.h)
  if (propagate) syncLinkedEdges(item, snapped.x, snapped.y, snapped.w, snapped.h)
  // resize 全走纯 layout 写入，而块内尺寸必须即时重排，所以每帧显式刷新
  markLayoutDirty()
}

// autoPan 时鼠标可能停住，所以在 rAF 循环内补偿被拖块并冻结联结传播
const compensateResizeAutoPan = () => {
  const rs = resizeSession
  if (!rs) return
  const item = state.items.find((it) => it.id === rs.itemId)
  if (item) applyResizeLayout(item, false)
}

const clampVal = (v: number, min: number, max: number | null) => {
  if (v < min) return min
  if (max != null && v > max) return max
  return v
}

const syncLinkedEdges = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const rs = resizeSession
  if (!rs || rs.itemId !== item.id) return
  propagateLinkedEdges(item, { x, y, w, h }, rs.starts)
}

// 沿链接图 BFS 传播共享边：尺寸按自身 min/max 钳制（与 VDR min=minWidth+8 一致），位置按起始 + 父块总位移重算（不逐帧累加，防错位）
const propagateLinkedEdges = (item: CanvasItem, rect: Rect, starts: Record<string, Rect>) => {
  const positions: Record<string, Rect> = {}
  const itemMap = new Map(state.items.map((target) => [target.id, target]))
  const neighborMap = linkedNeighborMap.value
  // autoPan 改变了 layout，所以 positions 用当前布局初始化，方位判定仍基于 starts
  Object.keys(starts).forEach((id) => {
    const target = itemMap.get(id)
    positions[id] = target ? { ...layoutOf(target) } : { ...starts[id] }
  })
  positions[item.id] = { ...rect }
  // 分维 BFS：右/下邻居正向传播（跟右/下缘），左/上邻居反向跟当前块，保持整链贴合
  const queue = [item.id]
  const seenX = new Set([item.id])
  const seenY = new Set([item.id])
  while (queue.length) {
    const pid = queue.shift()!
    const pRect = positions[pid]
    const pStart = starts[pid]
    if (!pRect || !pStart) continue
    ;(neighborMap.get(pid) ?? []).forEach((nid) => {
      const nStart = starts[nid]
      const target = itemMap.get(nid)
      if (!nStart || !target) return
      const c = constraintsOf(target)
      const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
      const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
      let enqueue = false
      // 交叉轴也贴合时会被另一轴拉走，所以只按主方向传播
      const xTouching = Math.abs(pStart.x + pStart.w - nStart.x) <= SNAP_TOLERANCE ||
        Math.abs(nStart.x + nStart.w - pStart.x) <= SNAP_TOLERANCE
      const yTouching = Math.abs(pStart.y + pStart.h - nStart.y) <= SNAP_TOLERANCE ||
        Math.abs(nStart.y + nStart.h - pStart.y) <= SNAP_TOLERANCE
      if (!seenX.has(nid) && Math.abs(pStart.x + pStart.w - nStart.x) <= SNAP_TOLERANCE && !yTouching) {
        // N 在 P 右：左缘跟右缘，宽度按当前右缘重算
        seenX.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        const curRight = nNew.x + nNew.w
        nNew.x = pRect.x + pRect.w
        nNew.w = clampVal(curRight - nNew.x, minW, maxW)
        positions[nid] = nNew
        enqueue = true
      } else if (!seenX.has(nid) && Math.abs(nStart.x + nStart.w - pStart.x) <= SNAP_TOLERANCE && !yTouching) {
        // N 在 P 左：右缘贴合 P 左缘
        seenX.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        nNew.w = clampVal(pRect.x - nNew.x, minW, maxW)
        nNew.x = pRect.x - nNew.w
        positions[nid] = nNew
        enqueue = true
      }
      if (!seenY.has(nid) && Math.abs(pStart.y + pStart.h - nStart.y) <= SNAP_TOLERANCE && !xTouching) {
        // N 在 P 下：上缘跟下缘，高度按当前下缘重算
        seenY.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        const curBottom = nNew.y + nNew.h
        nNew.y = pRect.y + pRect.h
        nNew.h = clampVal(curBottom - nNew.y, minH, maxH)
        positions[nid] = nNew
        enqueue = true
      } else if (!seenY.has(nid) && Math.abs(nStart.y + nStart.h - pStart.y) <= SNAP_TOLERANCE && !xTouching) {
        // N 在 P 上：下缘贴合 P 上缘
        seenY.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        nNew.h = clampVal(pRect.y - nNew.y, minH, maxH)
        nNew.y = pRect.y - nNew.h
        positions[nid] = nNew
        enqueue = true
      }
      if (enqueue) queue.push(nid)
    })
  }
  // A 的坐标已由 compensateResizeAutoPan 补偿，所以传播结果直接写回内容坐标即可
  Object.keys(positions).forEach((id) => {
    if (id === item.id) return
    const target = itemMap.get(id)
    if (!target) return
    const p = positions[id]
    const tl = layoutOf(target)
    tl.x = Math.round(p.x)
    tl.y = Math.round(p.y)
    tl.w = Math.round(p.w)
    tl.h = Math.round(p.h)
  })
}

const onResizeStart = (item: CanvasItem, handle: string) => {
  const starts: Record<string, Rect> = {}
  // 移动端不启用块联结，仅桌面端收集
  if (!mobileMode.value) {
    collectLinkedIds(item.id).forEach((id) => {
      const target = state.items.find((it) => it.id === id)
      if (target) starts[id] = { ...layoutOf(target) }
    })
  }
  resizeSession = {
    itemId: item.id,
    handle,
    starts,
    lastBase: { ...layoutOf(item) },
    panStartX: pan.x,
    panStartY: pan.y,
  }
}

// resize 到视口边缘时启动 autoPan（startAutoPan 幂等）
const onResizing = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const rs = resizeSession
  if (!rs || rs.itemId !== item.id) return
  rs.lastBase = { x, y, w, h }
  // 用会话累计 pan 变化判定会让 B 永久冻结，所以用实时是否在滚动判定
  const { vx: rx, vy: ry } = restrictedPanVelocity()
  applyResizeLayout(item, rx === 0 && ry === 0)
  startAutoPan()
}

const onResizeStop = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const rs = resizeSession
  if (rs && rs.itemId === item.id) {
    rs.lastBase = { x, y, w, h }
    // 松手瞬间就要恢复联结传播，所以先停 autoPan 再落位
    stopAutoPan()
    applyResizeLayout(item, true)
  } else {
    const layout = layoutOf(item)
    layout.x = Math.round(x)
    layout.y = Math.round(y)
    layout.w = Math.round(w)
    layout.h = Math.round(h)
    markLayoutDirty()
  }
  resizeSession = null
  recomputeMasks()
}
// #endregion 尺寸调整与联结传播

// 移动端纵向堆叠，autoHeight 变化后下方块须跟随平移，否则重叠
// #region 高度自适应
const shiftBlocksBelow = (item: CanvasItem, delta: number) => {
  if (delta === 0) return
  state.items
    .filter((it) => it.id !== item.id && it.layout.mobile.y > item.layout.mobile.y)
    .sort((a, b) => a.layout.mobile.y - b.layout.mobile.y)
    .forEach((it) => { it.layout.mobile.y += delta })
}

// 高度减小不应移动别的块，所以仅单向下推：横向重叠块按上缘排序，压到推动线才贴线并连锁
const pushOverlapped = (item: CanvasItem) => {
  const layout = layoutOf(item)
  const isOverlappingX = (o: Rect) => layout.x < o.x + o.w && layout.x + layout.w > o.x
  const column = state.items
    .filter((other) => other.id !== item.id && isOverlappingX(layoutOf(other)))
    .sort((a, b) => layoutOf(a).y - layoutOf(b).y)
  let cursor = layout.y + layout.h
  column.forEach((other) => {
    const o = layoutOf(other)
    if (o.y < cursor) {
      o.y = cursor
      cursor = o.y + o.h
    }
  })
}

const onAutoHeight = (e: Event) => {
  const detail = (e as CustomEvent<{ id?: string; height?: number; cursorY?: number }>).detail
  if (!detail?.id || typeof detail.height !== 'number') return
  const item = state.items.find((it) => it.id === detail.id)
  if (!item || item.component !== 'RichTextEditor') return
  const minH = (constraintsOf(item).minHeight ?? 0) + 8
  const h = Math.max(Math.round(detail.height), minH)
  const layout = layoutOf(item)
  if (layout.h !== h) {
    if (mobileMode.value) {
      // 先算 delta 再覆盖高度，使下方堆叠块跟随平移
      shiftBlocksBelow(item, h - layout.h)
      layout.h = h
    } else {
      const prevH = layout.h
      layout.h = h
      if (h > prevH) pushOverlapped(item)
    }
    scheduleGeometryRefresh()
    // 块高变化只写 layout（非响应式），所以必须显式刷新渲染
    markLayoutDirty()
  }
  // 用户手动平移时不应被光标跟随拉回，所以拖拽中跳过
  if (typeof detail.cursorY === 'number' && !isPanning.value) followCursor(item, detail.cursorY)
}

const CURSOR_VISIBLE_MARGIN = 24
const followCursor = (item: CanvasItem, cursorY: number) => {
  const cont = canvasContainerRef.value
  if (!cont) return
  const cr = cont.getBoundingClientRect()
  const l = layoutOf(item)
  // 块视觉位置 = 容器顶 + 块坐标*zoom + origin + pan
  const cursorBottom = cr.top + l.y * zoom.value + origin.y + pan.y + cursorY
  const over = cursorBottom - (cr.bottom - CURSOR_VISIBLE_MARGIN)
  if (over > 0) pan.y -= Math.round(over)
}
// #endregion 高度自适应

// #region 选中与聚焦
// Ctrl 加选/减选，否则单选
const selectOnClick = (id: string, e?: MouseEvent) => {
  if (!e?.ctrlKey) {
    state.selectedIds = new Set([id])
    return
  }
  const next = new Set(state.selectedIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  state.selectedIds = next
}

// 已在多选集合中的块被拖拽时保留整个集合
const selectForDrag = (id: string, e: MouseEvent) => {
  if (state.selectedIds.has(id) && state.selectedIds.size > 1) return
  selectOnClick(id, e)
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
  // 两个"刚结束"标记仅用于吞掉紧随的 click，新按下即新会话
  dragJustFinished = false
  selectionState.justFinishedSelection = false
  startSelection(e)
  startPan(e)
}

const startSelection = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (e.button !== 0) return
  if (target.closest('.drag-wrapper') || target.closest('.drag-handle') || target.closest('.toolbar')) return

  const rect = canvasContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  e.preventDefault()
  selectionState.active = true
  selectionState.extend = e.ctrlKey
  selectionState.justFinishedSelection = false
  // 事件挂容器级且 .canvas 带 pan/zoom，所以用 utils 统一换算
  const pt = screenToContent(canvasTransform(), rect, e.clientX, e.clientY)
  selectionState.startX = pt.x
  selectionState.startY = pt.y
  selectionState.currentX = selectionState.startX
  selectionState.currentY = selectionState.startY
  updateSelectionBox()
  // 点击空白也会激活框选会话，所以推迟到真正拖出框选框后再启动 autoPan
}

// 独立出"由坐标刷新框选"，供 autoPan 每帧调用（鼠标可能停住）
const updateSelectionAt = (clientX: number, clientY: number) => {
  if (!selectionState.active) return
  const rect = viewRect.value ?? canvasContainerRef.value?.getBoundingClientRect()
  if (!rect) return
  const pt = screenToContent(canvasTransform(), rect, clientX, clientY)
  selectionState.currentX = pt.x
  selectionState.currentY = pt.y
  updateSelectionBox()
  if (selectionBox.value) startAutoPan()
}

const updateSelection = (e: MouseEvent) => {
  if (!selectionState.active) return
  e.preventDefault()
  updateSelectionAt(e.clientX, e.clientY)
}

const onCanvasMousemove = (e: MouseEvent) => {
  updateSelection(e)
  updateHoverOwner(e)
  updateAddPreview(e)
}

// 预览跟随鼠标：落位解析每帧 O(N)，所以节流到 ~30fps；拖拽/框选会话激活时清空
const addPreviewKey = ref<CanvasItem['component'] | null>(null)
const addPreviewPos = ref<{ x: number; y: number } | null>(null)
let previewRafId = 0
let previewClientX = 0
let previewClientY = 0

const cancelPreviewFrame = () => {
  if (!previewRafId) return
  cancelAnimationFrame(previewRafId)
  previewRafId = 0
}

const applyAddPreview = () => {
  previewRafId = 0
  if (!isEditMode.value || state.selectedIds.size > 0 || !addPreviewKey.value || selectionState.active || customDrag.active) {
    addPreviewPos.value = null
    return
  }
  const rect = viewRect.value ?? canvasContainerRef.value?.getBoundingClientRect()
  if (rect) addPreviewPos.value = screenToContent(canvasTransform(), rect, previewClientX, previewClientY)
}

const updateAddPreview = (e: MouseEvent) => {
  if (!isEditMode.value || state.selectedIds.size > 0 || !addPreviewKey.value || selectionState.active || customDrag.active) {
    cancelPreviewFrame()
    if (addPreviewPos.value) addPreviewPos.value = null
    return
  }
  previewClientX = e.clientX
  previewClientY = e.clientY
  if (!previewRafId) previewRafId = requestAnimationFrame(applyAddPreview)
}

// 经方法设置，避免直接暴露 ref 的类型解包问题
const setAddPreview = (key: CanvasItem['component'] | null) => {
  cancelPreviewFrame()
  addPreviewKey.value = key
  if (!key) addPreviewPos.value = null
}

// 与真正添加共用 resolveAddSpot，保证预览与落位一致
const addPreviewSpot = computed(() => {
  const key = addPreviewKey.value
  const pos = addPreviewPos.value
  if (!key || !pos) return null
  return resolveAddSpot(key, pos).spot
})

// 移动端预览宽度取画布宽而非默认尺寸
const previewWidthOf = (key: CanvasItem['component']): number => {
  const meta = componentMetaOf(key)
  if (mobileMode.value) return canvasWidth.value || meta?.defaultSize.w || 0
  return meta?.defaultSize.w ?? 0
}

// 预览几何：content 坐标换算成视口像素
const previewGeometry = computed(() => {
  const key = addPreviewKey.value
  const spot = addPreviewSpot.value
  if (!key || !spot) return null
  const cr = viewRect.value
  if (!cr) return null
  const z = zoom.value
  const w = previewWidthOf(key)
  const h = componentMetaOf(key)?.defaultSize.h ?? 0
  const sc = contentToScreen(canvasTransform(), cr, spot.x, spot.y)
  return {
    left: sc.x,
    top: sc.y,
    right: sc.x + w * z,
    bottom: sc.y + h * z,
    centerX: sc.x + (w * z) / 2,
    centerY: sc.y + (h * z) / 2,
  }
})
const previewVisible = computed(() => {
  const g = previewGeometry.value
  const cr = viewRect.value
  if (!g || !cr) return false
  return g.left < cr.right && g.right > cr.left && g.top < cr.bottom && g.bottom > cr.top
})
// 预览框在视口外时需指示方向，所以按预览中心相对鼠标的方向角定位箭头
const previewArrowStyle = computed<CSSProperties>(() => {
  const g = previewGeometry.value
  const cr = viewRect.value
  if (!g || !cr) return {}
  const vx = mouseScreen.value.x
  const vy = mouseScreen.value.y
  const ang = Math.atan2(g.centerY - vy, g.centerX - vx)
  const radius = 22
  return {
    left: `${vx - cr.left + Math.cos(ang) * radius}px`,
    top: `${vy - cr.top + Math.sin(ang) * radius}px`,
    transform: `translate(-50%, -50%) rotate(${ang + Math.PI / 2}rad)`,
  }
})
// 仅在无选中块时显示，所以 z 复用 Z_LAYER.outline
const addPreviewStyle = computed<CSSProperties>(() => {
  const key = addPreviewKey.value
  const spot = addPreviewSpot.value
  if (!key || !spot) return {}
  return {
    left: `${roundToPx(spot.x)}px`,
    top: `${roundToPx(spot.y)}px`,
    width: `${roundToPx(previewWidthOf(key))}px`,
    height: `${roundToPx(componentMetaOf(key)?.defaultSize.h ?? 0)}px`,
    zIndex: Z_LAYER.outline,
  }
})

// scrollIntoView 会滚出容器偏移导致画面位移，所以归零容器滚动，由 pan 独占控制
const resetCanvasScroll = () => {
  const c = canvasContainerRef.value
  if (c && (c.scrollLeft !== 0 || c.scrollTop !== 0)) {
    c.scrollLeft = 0
    c.scrollTop = 0
  }
}

// 移入焦点会打断另一块正在输入的光标，所以焦点只由点击给出
const focusBlockContent = (id: string) => {
  nextTick(() => {
    resetCanvasScroll()
    const wrapper = document.querySelector(`.drag-wrapper[data-id="${id}"]`)
    const pm = wrapper?.querySelector('.ProseMirror') as HTMLElement | null
    if (pm) {
      pm.focus({ preventScroll: true })
      return
    }
    const ta = wrapper?.querySelector('textarea') as HTMLElement | null
    if (ta) ta.focus({ preventScroll: true })
  })
}
// #endregion 选中与聚焦

// 记录 popup 所在块 id，以便只隐藏该块的 tm 手柄
// #region 弹层与命中测试
const popupBlockId = ref<string | null>(null)
const onBlockPopupChange = (e: Event) => {
  const detail = (e as CustomEvent).detail as { open?: boolean; blockId?: string | null }
  // 旧块关闭事件会误清新块状态，所以仅当 id 匹配时才清除
  if (detail.open && detail.blockId) {
    popupBlockId.value = detail.blockId
  } else if (!detail.open && detail.blockId && popupBlockId.value === detail.blockId) {
    popupBlockId.value = null
  }
}

// popupBlockId 仅表示覆盖 tm 手柄，所以另设 popupActiveBlockId 表示 popup 是否弹出
const popupActiveBlockId = ref<string | null>(null)
const onBlockHandleActiveChange = (e: Event) => {
  const detail = (e as CustomEvent).detail as { active?: boolean; blockId?: string | null }
  // 旧块关闭事件会误清新块状态，所以仅当 id 匹配时才清除
  if (detail.active && detail.blockId) {
    popupActiveBlockId.value = detail.blockId
  } else if (!detail.active && detail.blockId && popupActiveBlockId.value === detail.blockId) {
    popupActiveBlockId.value = null
  }
}

const popupTopOpen = ref(false)
const onBlockPopupTopChange = (e: Event) => {
  const detail = (e as CustomEvent).detail as { open?: boolean }
  popupTopOpen.value = !!detail.open
}

// 候选改为缓存后，需在 popup 上侧开关/链接变化时显式刷新
watch([popupTopOpen, linkedPairs], () => { paperclipCandidates.value = computePaperclipCandidates() })

// 手柄与块间留 2px 缝隙，鼠标经过时仍命中手柄所属块，避免焦点转到背后组件
const HANDLE_GAP = 2

interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

type ScreenRectFactory = (x: number, y: number, w: number, h: number) => ScreenRect | null

// 逐 mousemove 读 DOM 矩形会强制同步布局，所以用公式直接换算屏幕矩形（误差 ≤0.5px）
const screenRectFactory = (): ScreenRectFactory => {
  const cr = viewRect.value
  const t = canvasTransform()
  return (x, y, w, h) => {
    if (!cr) return null
    const tl = contentToScreen(t, cr, x, y)
    return { left: tl.x, top: tl.y, right: tl.x + w * t.zoom, bottom: tl.y + h * t.zoom }
  }
}

const insideScreenRect = (rect: ScreenRect, clientX: number, clientY: number): boolean =>
  clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom

// 复刻 sideSettingsStyle 的几何
const settingsBarRectOf = (rectOf: ScreenRectFactory, item: CanvasItem): ScreenRect | null => {
  const l = layoutOf(item)
  const top = handlePlacementOf(item) === 'bottom' ? l.y + l.h : l.y - HANDLE_HEIGHT
  const left = l.x + l.w - SIDE_SETTINGS_WIDTH - SIDE_SETTINGS_MARGIN
  return rectOf(left, top, SIDE_SETTINGS_WIDTH, HANDLE_HEIGHT)
}

// 三个命中判定都只在选中块里找，所以先取选中块小集合（原实现每次 pointermove 都遍历全量块、随块数线性劣化）
const selectedBlockItems = (): CanvasItem[] =>
  state.selectedIds.size === 0 ? [] : state.items.filter((it) => state.selectedIds.has(it.id))

const hitSettingsBar = (clientX: number, clientY: number): string | null => {
  const rectOf = screenRectFactory()
  const hit = selectedBlockItems().find((item) => {
    if (!isActive(item.id)) return false
    const rect = settingsBarRectOf(rectOf, item)
    return !!rect && insideScreenRect(rect, clientX, clientY)
  })
  return hit?.id ?? null
}

const RESIZE_HANDLE_HIT_MARGIN = 2
// 常量要与 ResizeBox 的 HANDLE_POS/HANDLE_SIZE 保持一致
const HANDLE_SIZE = 8
const HANDLE_OUTSET = 5
const handleContentPos = (handle: string, l: Rect): { x: number; y: number } => ({
  x: handle.includes('l') ? l.x - HANDLE_OUTSET
    : handle.includes('r') ? l.x + l.w - HANDLE_OUTSET
      : l.x + l.w / 2 - HANDLE_SIZE / 2,
  y: handle.includes('t') ? l.y - HANDLE_OUTSET
    : handle.includes('b') ? l.y + l.h - HANDLE_OUTSET
      : l.y + l.h / 2 - HANDLE_SIZE / 2,
})

const makeResizeHandleHitTest = (clientX: number, clientY: number) => {
  const rectOf = screenRectFactory()
  return (item: CanvasItem): boolean => {
    const l = layoutOf(item)
    return resizeHandlesOf(item).some((handle) => {
      const pos = handleContentPos(handle, l)
      const rect = rectOf(pos.x, pos.y, HANDLE_SIZE, HANDLE_SIZE)
      if (!rect) return false
      return clientX >= rect.left - RESIZE_HANDLE_HIT_MARGIN && clientX <= rect.right + RESIZE_HANDLE_HIT_MARGIN &&
        clientY >= rect.top - RESIZE_HANDLE_HIT_MARGIN && clientY <= rect.bottom + RESIZE_HANDLE_HIT_MARGIN
    })
  }
}

const hitResizeHandle = (clientX: number, clientY: number): string | null => {
  const test = makeResizeHandleHitTest(clientX, clientY)
  return selectedBlockItems().find((item) => isActive(item.id) && test(item))?.id ?? null
}

const hitHandle = (clientX: number, clientY: number): string | null => {
  for (const item of selectedBlockItems()) {
    const el = document.querySelector<HTMLElement>(`.floating-handle[data-id="${item.id}"]`)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return item.id
    const inGapY = handlePlacementOf(item) === 'top'
      ? clientY >= rect.bottom && clientY <= rect.bottom + HANDLE_GAP
      : clientY <= rect.top && clientY >= rect.top - HANDLE_GAP
    if (clientX >= rect.left && clientX <= rect.right && inGapY) return item.id
  }
  return null
}

// 鼠标移向 popup 会经过块间空隙被判为块外，所以按坐标（4px 容差）命中 popup
const POPUP_HIT_MARGIN = 4
// 遍历全部 popup 读矩形会强制布局，所以只按 id 定向查询已激活的 popup
const popupHitId = (id: string | null, clientX: number, clientY: number): string | null => {
  if (!id) return null
  const el = document.querySelector<HTMLElement>(`.block-handle-popup[data-block-id="${id}"]`)
  const r = el?.getBoundingClientRect()
  if (!r) return null
  const inX = clientX >= r.left - POPUP_HIT_MARGIN && clientX <= r.right + POPUP_HIT_MARGIN
  const inY = clientY >= r.top - POPUP_HIT_MARGIN && clientY <= r.bottom + POPUP_HIT_MARGIN
  return inX && inY ? id : null
}

const hitPopupBlock = (clientX: number, clientY: number): string | null =>
  popupHitId(popupActiveBlockId.value, clientX, clientY) ?? popupHitId(popupBlockId.value, clientX, clientY)

// 命中优先级：设置栏 → 缩放手柄 → popup → 拖拽栏/缝隙 → 块本体；先走 O(1) closest，空白处才几何命中
const resolvePointerHit = (e: MouseEvent): string | null => {
  const target = e.target as HTMLElement
  const directId = target.closest<HTMLElement>('.side-settings, .handle, .drag-handle, .drag-wrapper')?.dataset.id
  if (directId) return directId
  return hitSettingsBar(e.clientX, e.clientY) ?? hitResizeHandle(e.clientX, e.clientY)
    ?? hitPopupBlock(e.clientX, e.clientY) ?? hitHandle(e.clientX, e.clientY)
}

// 按鼠标到各选中块矩形的最小距离取最近者（仅空白命中时调用）
const nearestSelectedBlockId = (clientX: number, clientY: number): string | null => {
  // 预览开启时高频触发，所以无选中块时短路
  if (state.selectedIds.size === 0) return null
  if (!viewRect.value) return null
  const rectOf = screenRectFactory()
  let bestId: string | null = null
  let bestDist = Infinity
  state.items.forEach((item) => {
    if (!state.selectedIds.has(item.id)) return
    const l = layoutOf(item)
    const rect = rectOf(l.x, l.y, l.w, l.h)
    if (!rect) return
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right)
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom)
    const dist = Math.hypot(dx, dy)
    if (dist < bestDist) {
      bestDist = dist
      bestId = item.id
    }
  })
  return bestId
}

// 选中只由点击/框选决定，悬停仅切换浮层归属
const hoveredBlockId = ref<string | null>(null)
const outlineOwnerId = computed(() => customDrag.active ? customDrag.sourceItemId : hoveredBlockId.value)

// 逐块 v-if 每帧为全部块求值会掉帧，所以先算出小集合再渲染
const floatingOwnerId = computed(() => {
  if (!isEditMode.value) return null
  const id = customDrag.active ? customDrag.sourceItemId : hoveredBlockId.value
  return id && state.selectedIds.has(id) ? id : null
})
const floatingOwnerItem = computed(() => state.items.find((it) => it.id === floatingOwnerId.value) ?? null)
// popup 弹出时块顶部手柄隐藏，拖拽栏一并隐藏以免争位
const floatingHandleItem = computed(() => {
  const item = floatingOwnerItem.value
  return item && popupBlockId.value !== item.id ? item : null
})
const sideSettingsItem = computed(() =>
  floatingOwnerItem.value?.component === 'RichTextEditor' ? floatingOwnerItem.value : null
)
const selectedOutlineItems = computed(() =>
  isEditMode.value ? state.items.filter((it) => state.selectedIds.has(it.id)) : []
)

const onFloatingHandleDown = (e: MouseEvent) => {
  const item = floatingHandleItem.value
  if (item) startCustomDrag(item, e)
}

const onAutoHeightToggle = (value: unknown) => {
  const item = sideSettingsItem.value
  if (item) setAutoHeight(item, !!value)
}

// 归属块必须是选中块，否则取最近选中块，避免鼠标扫过未选中块时拖拽栏全消失
const applyFloatingOwner = (hitId: string | null, clientX: number, clientY: number) => {
  const owner = hitId && state.selectedIds.has(hitId) ? hitId : nearestSelectedBlockId(clientX, clientY)
  if (owner !== hoveredBlockId.value) hoveredBlockId.value = owner
}

const isHoverOwnerLocked = (e: MouseEvent): boolean =>
  !isEditMode.value || e.button !== 0 || !!resizeSession || selectionState.active || customDrag.active
  || !!popupActiveBlockId.value || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey

// 悬停只切换浮层归属
const updateHoverOwner = (e: MouseEvent) => {
  if (isHoverOwnerLocked(e)) return
  applyFloatingOwner(resolvePointerHit(e), e.clientX, e.clientY)
}
// #endregion 弹层与命中测试

// #region 框选收尾与点击
const finishSelection = () => {
  if (!selectionState.active) return
  selectionState.active = false
  stopAutoPan()
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

// 浏览器已原生聚焦可编辑内容，所以仅块内非交互区域补聚焦，且焦点已在本块内时不重设
const FOCUS_SKIP_SELECTOR =
  'button, a, input, select, textarea, [contenteditable="true"], [role="button"], .v-btn, .v-menu, .v-overlay, .block-handle-positioner'

const focusBlockOnClick = (id: string, target: HTMLElement) => {
  const wrapper = document.querySelector<HTMLElement>(`.drag-wrapper[data-id="${id}"]`)
  if (!wrapper || wrapper.contains(document.activeElement)) return
  if (target.closest(FOCUS_SKIP_SELECTOR)) return
  focusBlockContent(id)
}

const handleCanvasClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (selectionState.justFinishedSelection || dragJustFinished) {
    selectionState.justFinishedSelection = false
    dragJustFinished = false
    return
  }
  if (target.closest('.handle, .drag-handle, .side-settings, .snap-paperclip, .toolbar')) return
  const id = target.closest<HTMLElement>('.drag-wrapper')?.dataset.id
  if (id && state.items.some((item) => item.id === id)) {
    if (!isEditMode.value) return
    selectOnClick(id, e)
    bringToTop(id)
    // 点击时鼠标不再移动、悬停归属不会自行更新，所以选中后立即把归属指到该块（未被选中时回落为最近选中块）
    applyFloatingOwner(id, e.clientX, e.clientY)
    focusBlockOnClick(id, target)
    return
  }
  state.selectedIds = new Set()
}

// 选中由 click 统一处理，所以 focusin 只提升层级
const handleCanvasFocusin = (e: FocusEvent) => {
  const wrapper = (e.target as HTMLElement).closest<HTMLElement>('.drag-wrapper')
  const id = wrapper?.dataset.id
  if (!id || !isEditMode.value) return
  if (!state.items.some((item) => item.id === id)) return
  bringToTop(id)
}
// #endregion 框选收尾与点击

// #region 数据同步与布局刷新
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

const ARRANGE_GAP = 16
const ARRANGE_TOP = 16
const ARRANGE_LEFT = 16

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
    // 旧数据可能缺失移动端位置/高度，从桌面布局补齐
    if (mobile.y == null) mobile.y = desktop.y
    if (mobile.h == null) mobile.h = desktop.h
  })
}

const refreshLayout = () => {
  updateCanvasWidth()
  if (mobileMode.value) applyMobileLayout()
}

// 内容要在组件重挂载前同步，所以用 flush: 'pre'
watch(mobileMode, () => {
  syncComponentData()
  if (mobileMode.value) {
    // 移动端锁水平，所以把水平原点并入桌面布局并归零
    if (origin.x) {
      state.items.forEach((it) => { it.layout.desktop.x += origin.x })
      origin.x = 0
    }
    // 移动端按视口宽度拉伸，所以归零缩放；归零属模式重置，跳过锚点补偿
    zoomAnchorPrev = 1
    zoom.value = 1
  }
  // 残留 pan.y 会把另一布局顶出视口，所以切换时归零平移
  pan.x = 0
  pan.y = 0
  autoArrange(mobileMode.value ? 'mobile' : 'desktop')
  recomputeMasks()
  nextTick(refreshLayout)
}, { flush: 'pre' })

// 块删除后其曲别针链接失效，随 items 变化自动清理
watch(
  () => state.items.map((it) => it.id),
  (ids) => {
    const idSet = new Set(ids)
    linkedPairs.value = new Set(
      Array.from(linkedPairs.value).filter((k) => k.split('|').every((id) => idSet.has(id)))
    )
  }
)

// 编辑器嵌在块内拿不到画布选中态，所以选中集变化时派发全局事件
watch(
  () => [...state.selectedIds].sort().join(','),
  () => window.dispatchEvent(new CustomEvent('Mindrizzle:block-selection', { detail: { ids: [...state.selectedIds] } })),
)

const onResize = () => {
  refreshViewRect()
  refreshLayout()
  invalidateCanvasScaleCache()
  recomputeMasks()
}
// #endregion 数据同步与布局刷新

// 未排的块按桌面阅读顺序纵向堆叠在已排块下方（x 恒 0）
// #region 自动布局与添加
const autoArrangeMobile = () => {
  const pending = state.items.filter((it) => !it.arranged.mobile)
  if (pending.length === 0) return
  let cursor = ARRANGE_TOP
  state.items.forEach((it) => {
    if (it.arranged.mobile) cursor = Math.max(cursor, it.layout.mobile.y + it.layout.mobile.h)
  })
  pending
    .sort((a, b) => a.layout.desktop.y - b.layout.desktop.y)
    .forEach((it) => {
      const m = it.layout.mobile
      m.x = 0
      m.h = m.h > 0 ? m.h : it.layout.desktop.h
      m.y = Math.round(cursor + ARRANGE_GAP)
      cursor = m.y + m.h
      it.arranged.mobile = true
    })
}

// 未排的块按视口宽度瀑布流平铺在已排块下方
const autoArrangeDesktop = () => {
  const pending = state.items.filter((it) => !it.arranged.desktop)
  if (pending.length === 0) return
  let cursorY = ARRANGE_TOP
  state.items.forEach((it) => {
    if (it.arranged.desktop) cursorY = Math.max(cursorY, it.layout.desktop.y + it.layout.desktop.h)
  })
  const maxX = Math.max(canvasWidth.value / zoom.value, ARRANGE_LEFT * 2)
  let cursorX = ARRANGE_LEFT
  let rowH = 0
  pending
    .sort((a, b) => a.layout.desktop.y - b.layout.desktop.y)
    .forEach((it) => {
      const d = it.layout.desktop
      if (cursorX + d.w > maxX - ARRANGE_LEFT) {
        cursorX = ARRANGE_LEFT
        cursorY += rowH + ARRANGE_GAP
        rowH = 0
      }
      d.x = cursorX
      d.y = Math.round(cursorY)
      cursorX += d.w + ARRANGE_GAP
      rowH = Math.max(rowH, d.h)
      it.arranged.desktop = true
    })
}

const autoArrange = (mode: 'desktop' | 'mobile') => {
  if (mode === 'mobile') autoArrangeMobile()
  else autoArrangeDesktop()
  // 排列只写 layout（非响应式），所以须显式刷新
  markLayoutDirty()
}

// 桌面端取各已放块底部作候选顶边、视口内从左到右找空位（贴底候选比固定网格更紧凑）；移动端追加到末尾
const freeSpotFor = (w: number, h: number): { x: number; y: number } => {
  if (mobileMode.value) {
    let maxBottom = 0
    state.items.forEach((it) => {
      maxBottom = Math.max(maxBottom, it.layout.mobile.y + it.layout.mobile.h)
    })
    return { x: 0, y: Math.round(maxBottom + ARRANGE_GAP) }
  }
  const placed = state.items.map((it) => layoutOf(it))
  // canvasWidth 是像素，所以换算 content 宽度需除 zoom（否则换行边界错位）
  const vx = Math.round(-(origin.x + pan.x) / zoom.value)
  const vy = Math.round(-(origin.y + pan.y) / zoom.value)
  const viewW = Math.max(canvasWidth.value / zoom.value, ARRANGE_LEFT * 2)
  // vx 随 panToBlock 漂移会让连续添加的块逐次左偏，所以 x 起点对齐既有块最左 x
  const leftBase = placed.length ? Math.min(...placed.map((p) => p.x)) : vx + ARRANGE_LEFT
  // 有块时只取各块底部贴底，无块时用视口顶
  const candidateYs = placed.length
    ? placed.map((p) => p.y + p.h + ARRANGE_GAP).sort((a, b) => a - b)
    : [vy + ARRANGE_TOP]
  for (const cy of candidateYs) {
    let cursorX = leftBase
    while (cursorX + w <= leftBase + viewW - ARRANGE_LEFT) {
      const overlap = placed.some((p) => cursorX < p.x + p.w && cursorX + w > p.x && cy < p.y + p.h && cy + h > p.y)
      if (!overlap) return { x: Math.round(cursorX), y: Math.round(cy) }
      cursorX += w + ARRANGE_GAP
    }
  }
  const maxBottom = state.items.reduce((m, it) => Math.max(m, layoutOf(it).y + layoutOf(it).h), vy)
  return { x: leftBase, y: Math.round(maxBottom + ARRANGE_GAP) }
}

// 让块中心落在视口中心：按 屏幕 = 坐标*zoom + origin + pan 反解 pan
const panToBlock = (id: string) => {
  const item = state.items.find((it) => it.id === id)
  if (!item) return
  const layout = layoutOf(item)
  const cont = canvasContainerRef.value
  const vw = cont?.clientWidth ?? window.innerWidth
  const vh = cont?.clientHeight ?? window.innerHeight
  const cx = (layout.x + layout.w / 2) * zoom.value
  const cy = (layout.y + layout.h / 2) * zoom.value
  if (!mobileMode.value) pan.x = Math.round(vw / 2 - origin.x - cx)
  pan.y = Math.round(vh / 2 - origin.y - cy)
}

// 新增块在屏幕内不动摄像机，在屏幕外才移动视角
const isRectVisibleInViewport = (rect: Rect): boolean => {
  const cont = canvasContainerRef.value
  if (!cont) return true
  const cr = cont.getBoundingClientRect()
  const tl = contentToScreen(canvasTransform(), cr, rect.x, rect.y)
  const br = contentToScreen(canvasTransform(), cr, rect.x + rect.w, rect.y + rect.h)
  return tl.x < cr.right && br.x > cr.left && tl.y < cr.bottom && br.y > cr.top
}

// 每帧 O(N) 检测重叠开销大，所以用块群包围盒粗筛
const itemsBounds = computed(() => {
  // layout 已非响应式，所以显式订阅版本号
  void layoutVersion.value
  if (state.items.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  state.items.forEach((it) => {
    const l = layoutOf(it)
    if (l.x < minX) minX = l.x
    if (l.y < minY) minY = l.y
    if (l.x + l.w > maxX) maxX = l.x + l.w
    if (l.y + l.h > maxY) maxY = l.y + l.h
  })
  return { minX, minY, maxX, maxY }
})

// 鼠标处不重叠用鼠标处、重叠则自动排列；添加与预览共用
const resolveAddSpot = (key: CanvasItem['component'], at?: { x: number; y: number }): { spot: { x: number; y: number } } => {
  const meta = componentMetaOf(key)
  if (!meta) return { spot: { x: 0, y: 0 } }
  if (!at) return { spot: freeSpotFor(meta.defaultSize.w, meta.defaultSize.h) }
  if (mobileMode.value) {
    // 移动端锁水平（x 恒 0、宽贴屏），但 y 跟随鼠标位置
    return { spot: { x: 0, y: Math.round(at.y) } }
  }
  const { w, h } = meta.defaultSize
  const overlapsAt = (x: number, y: number) => {
    const b = itemsBounds.value
    if (b && (x + w <= b.minX || x >= b.maxX || y + h <= b.minY || y >= b.maxY)) return false
    return state.items.some((it) => {
      const l = layoutOf(it)
      return x < l.x + l.w && x + w > l.x && y < l.y + l.h && y + h > l.y
    })
  }
  const spot = { x: Math.round(at.x), y: Math.round(at.y) }
  return overlapsAt(spot.x, spot.y)
    ? { spot: freeSpotFor(w, h) }
    : { spot }
}

const addComponent = (key: CanvasItem['component'], at?: { x: number; y: number }, config?: WidgetConfig): string | null => {
  const meta = componentMetaOf(key)
  if (!meta) return null
  const id = generateId()
  const { spot } = resolveAddSpot(key, at)
  const { x, y } = spot
  // 块对象须保持原始对象（拖拽逐帧写 layout 不该触发重渲染），所以 markRaw
  const newItem: CanvasItem = markRaw({
    id,
    component: key,
    config: config ?? meta.defaultConfig(),
    layout: {
      desktop: { x, y, ...meta.defaultSize },
      mobile: { x: 0, y, ...meta.defaultSize },
    },
    arranged: { desktop: !mobileMode.value, mobile: mobileMode.value },
  })
  state.items.push(newItem)
  if (mobileMode.value && canvasWidth.value > 0) {
    stretchMobileWidth(newItem)
  }
  if (!isRectVisibleInViewport(layoutOf(newItem))) panToBlock(newItem.id)
  recomputeMasks()
  return id
}
// #endregion 自动布局与添加

// #region 插入组件拖出成块
// 插入组件名 → 画布块类型，及 props → 块 config 的换算
const EXTRACT_RULES: Record<
  string,
  { key: CanvasItem['component']; toConfig: (props: Record<string, any>) => WidgetConfig }
> = {
  CodeBlock: {
    key: 'EditableCodeBlock',
    toConfig: (props) => ({ code: props.modelValue ?? '', language: props.language ?? 'javascript' }),
  },
}

// 仅编辑态且落点在画布内才新增块，经 detail.accepted 同步回填结果
type ExtractDetail = {
  componentName: string
  props: Record<string, any>
  clientX: number
  clientY: number
  accepted: boolean
}
const onExtractComponent = (event: Event) => {
  const detail = (event as CustomEvent<ExtractDetail>).detail
  const rule = detail && EXTRACT_RULES[detail.componentName]
  const rect = canvasContainerRef.value?.getBoundingClientRect()
  if (!rule || !rect || !isEditMode.value) return
  const isInside = detail.clientX >= rect.left && detail.clientX <= rect.right
    && detail.clientY >= rect.top && detail.clientY <= rect.bottom
  if (!isInside) return
  const id = addComponent(
    rule.key,
    screenToContent(canvasTransform(), rect, detail.clientX, detail.clientY),
    rule.toConfig(detail.props),
  )
  if (!id) return
  detail.accepted = true
  // 抽出后新块置为选中以给反馈，并对随之补发的 click 置标记，避免被当"点击空白"清掉选中
  state.selectedIds = new Set([id])
  dragJustFinished = true
}
// #endregion 插入组件拖出成块

// #region 保存与加载
const save = () => {
  syncComponentData()
  // 块坐标需保持小值防溢出，所以以块群包围盒中心为新原点保存相对坐标
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
    x: Math.round(r.x + origin.x + pan.x - cx),
    y: Math.round(r.y + origin.y + pan.y - cy),
    w: Math.round(r.w),
    h: Math.round(r.h),
  })
  // 移动端宽度运行时拉伸，不持久化
  const serializable = state.items.map((it) => ({
    id: it.id,
    component: it.component,
    config: it.config,
    layout: {
      desktop: toSaveRect(it.layout.desktop),
      mobile: { x: 0, y: Math.round(it.layout.mobile.y + origin.y + pan.y - cy), h: Math.round(it.layout.mobile.h) },
    },
    arranged: { ...it.arranged },
  }))
  return JSON.stringify({ origin: { x: cx, y: cy }, items: serializable, links: Array.from(linkedPairs.value) })
}

// 兼容双端布局重构前的扁平格式并对缺失字段兜底
const normalizeLoadedItem = (it: any): CanvasItem => {
  const component: CanvasItem['component'] = componentMap[it.component as CanvasItem['component']]
    ? (it.component as CanvasItem['component'])
    : 'RichTextEditor'
  const isLegacyFlat = !it.layout && typeof it.x === 'number' && typeof it.y === 'number'
  const desktop: Rect = isLegacyFlat
    ? { x: it.x, y: it.y, w: it.w ?? 400, h: it.h ?? 300 }
    : { x: 0, y: 0, w: 400, h: 300, ...(it.layout?.desktop ?? {}) }
  const mobile: Rect = { ...desktop, ...(it.layout?.mobile ?? {}) }
  // 坐标异常会使块丢失，所以一律归 0
  desktop.x = typeof desktop.x === 'number' ? desktop.x : 0
  desktop.y = typeof desktop.y === 'number' ? desktop.y : 0
  mobile.x = typeof mobile.x === 'number' ? mobile.x : 0
  mobile.y = typeof mobile.y === 'number' ? mobile.y : 0
  // 旧数据无 arranged：desktop 视为已排，mobile 与 desktop 完全一致（纯副本）则视为未排
  let arranged = { desktop: true, mobile: true }
  if (it.arranged && typeof it.arranged === 'object') {
    arranged = {
      desktop: it.arranged.desktop !== false,
      mobile: it.arranged.mobile !== false,
    }
  } else {
    const savedMobile = it.layout?.mobile
    const mobileIsCopy = !savedMobile || (savedMobile.y === desktop.y && savedMobile.h === desktop.h)
    arranged = { desktop: true, mobile: !mobileIsCopy }
  }
  // 块对象须保持原始对象（拖拽逐帧写 layout 不该触发重渲染），所以 markRaw
  return markRaw({
    id: typeof it.id === 'string' && it.id ? it.id : generateId(),
    component,
    config: (it.config ?? componentMetaOf(component)?.defaultConfig() ?? {}) as WidgetConfig,
    layout: { desktop, mobile },
    arranged,
  })
}

const load = async (raw: string) => {
  if (!raw) return
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return // 忽略，数据损坏不影响主流程
  }
  if (Array.isArray(parsed)) {
    state.items = parsed.map(normalizeLoadedItem)
    origin.x = 0
    origin.y = 0
  } else if (parsed && Array.isArray(parsed.items)) {
    state.items = parsed.items.map(normalizeLoadedItem)
    origin.x = typeof parsed.origin?.x === 'number' ? parsed.origin.x : 0
    origin.y = typeof parsed.origin?.y === 'number' ? parsed.origin.y : 0
  } else {
    return
  }
  // 保存坐标相对 origin 归一化，加载后归零平移、从原点查看内容
  pan.x = 0
  pan.y = 0
  // 曲别针链接随文档持久化（watcher 会过滤失效链接）
  linkedPairs.value = new Set(
    Array.isArray(parsed.links) ? parsed.links.filter((k: unknown) => typeof k === 'string') : []
  )
  await nextTick()
  await nextTick()
  if (mobileMode.value) {
    // origin.x 非 0 会把块水平顶出屏外，所以并入 desktop.x 并归零
    if (origin.x) {
      state.items.forEach((it) => { it.layout.desktop.x += origin.x })
      origin.x = 0
    }
    updateCanvasWidth()
    applyMobileLayout()
  }
  autoArrange(mobileMode.value ? 'mobile' : 'desktop')
  state.items.forEach((item) => {
    componentRefs.value[item.id]?.loadConfig?.(item.config)
  })
  recomputeMasks()
}
// #endregion 保存与加载

// #region 命令与生命周期
const batchToggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  Array.from(state.selectedIds).forEach((id) => {
    componentRefs.value[id]?.commands?.toggleHeading?.({ level })
  })
}

const deleteSelected = () => {
  if (!isEditMode.value || state.selectedIds.size === 0) return
  const ids = Array.from(state.selectedIds)
  state.items = state.items.filter((it) => !ids.includes(it.id))
  state.selectedIds = new Set()
  ids.forEach(id => { delete componentRefs.value[id] })
  recomputeMasks() // 删除块会改变贴合关系，刷新遮罩
}

// mouseup 丢失会让会话残留、守卫永久禁用，所以失焦/指针取消时统一重置
const abortSessions = () => {
  if (customDrag.active) onCustomDragUp()
  if (selectionState.active) finishSelection()
  if (panSession.active) stopPan()
  leftButtonDown = false
}

onMounted(() => {
  refreshViewRect()
  nextTick(refreshLayout)
  canvasContainerRef.value?.addEventListener('mousedown', handleCanvasMouseDownCapture, true)
  window.addEventListener('mousedown', onGlobalMouseDownCapture, true)
  window.addEventListener('mousedown', trackLeftButtonDown, true)
  window.addEventListener('mouseup', trackLeftButtonUp, true)
  window.addEventListener('resize', onResize)
  // ProseMirror 会冒泡拦截 mousemove，所以监听用捕获阶段
  window.addEventListener('mousemove', updateSelection, true)
  window.addEventListener('mouseup', finishSelection)
  window.addEventListener('mousemove', updatePan, true)
  window.addEventListener('mouseup', stopPan)
  window.addEventListener('contextmenu', preventContextMenu)
  window.addEventListener('mousemove', updateMousePos, true)
  window.addEventListener('Mindrizzle:canvas-pan', onCanvasPanEvent)
  window.addEventListener('Mindrizzle:extract-component', onExtractComponent)
  window.addEventListener('Mindrizzle:block-popup', onBlockPopupChange)
  window.addEventListener('Mindrizzle:block-popup-top', onBlockPopupTopChange)
  window.addEventListener('Mindrizzle:block-handle-active', onBlockHandleActiveChange)
  window.addEventListener('Mindrizzle:auto-height', onAutoHeight)
  window.addEventListener('blur', abortSessions)
  window.addEventListener('pointercancel', abortSessions)
})

onUnmounted(() => {
  cancelPreviewFrame()
  if (geometryRafId) cancelAnimationFrame(geometryRafId)
  canvasContainerRef.value?.removeEventListener('mousedown', handleCanvasMouseDownCapture, true)
  window.removeEventListener('mousedown', onGlobalMouseDownCapture, true)
  window.removeEventListener('mousedown', trackLeftButtonDown, true)
  window.removeEventListener('mouseup', trackLeftButtonUp, true)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', updateSelection, true)
  window.removeEventListener('mouseup', finishSelection)
  window.removeEventListener('mousemove', updatePan, true)
  window.removeEventListener('mouseup', stopPan)
  window.removeEventListener('contextmenu', preventContextMenu)
  window.removeEventListener('mousemove', updateMousePos, true)
  window.removeEventListener('Mindrizzle:canvas-pan', onCanvasPanEvent)
  window.removeEventListener('Mindrizzle:extract-component', onExtractComponent)
  window.removeEventListener('Mindrizzle:block-popup', onBlockPopupChange)
  window.removeEventListener('Mindrizzle:block-popup-top', onBlockPopupTopChange)
  window.removeEventListener('Mindrizzle:block-handle-active', onBlockHandleActiveChange)
  window.removeEventListener('Mindrizzle:auto-height', onAutoHeight)
  window.removeEventListener('blur', abortSessions)
  window.removeEventListener('pointercancel', abortSessions)
})

defineExpose({
  state,
  pan,
  origin,
  zoom,
  mobileMode,
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
  setAddPreview,
  save,
  load,
  rebaseOrigin,
  batchToggleHeading,
  deleteSelected,
  compensateResizeAutoPan,
})
// #endregion 命令与生命周期
</script>

<style scoped>
.canvas-container {
  flex: 1;
  /* flex item 默认 min-height:auto 会被内容撑高、溢出 v-main，所以允许收缩 */
  min-height: 0;
  position: relative;
  /* overflow:hidden 仍是滚动容器、会被 scrollIntoView 改写 scrollLeft/Top，所以用 clip；旧引擎回退 hidden */
  overflow: hidden;
  overflow: clip;
}

/* 点阵层仅比容器大一圈，所以用 transform 随 pan 合成移动且不挡交互 */
.canvas-dots {
  position: absolute;
  /* 层尺寸与 background-size 由 dotsStyle 随 zoom 提供 */
  background-image: radial-gradient(circle, rgba(var(--v-theme-on-surface), 0.15) 1px, transparent 1px);
  background-repeat: repeat;
  pointer-events: none;
}

/* 平移无界：块用世界坐标定位，超出视口部分由容器裁剪 */
.canvas {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  cursor: grab;
}

.connection-layer {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 1;
}

.connection-segment {
  position: absolute;
  background: rgb(var(--v-theme-primary));
  opacity: 0.7;
}

.canvas.panning {
  cursor: grabbing;
  user-select: none;
}

/* 拖拽中的块会盖住落点处的编辑器，所以让其命中穿透 */
.drag-wrapper.drag-passthrough {
  pointer-events: none;
}

.selection-box {
  position: absolute;
  /* --v-theme-primary 为 RGB 分量，所以须用 rgb() 包裹 */
  border: 1px dashed rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  pointer-events: none;
  z-index: 55;
}

.drag-wrapper :deep(.handle) {
  z-index: 20;
}

/* 描边需在拖拽栏/缩放手柄之上保持连贯，所以用独立 overlay（--v-theme-primary 须经 rgb() 包裹） */
.selected-outline {
  position: absolute;
  border: 2px solid rgb(var(--v-theme-primary));
  pointer-events: none;
  z-index: 1002;
  box-sizing: border-box;
}

.rich-text-drop-target {
  position: absolute;
  border: 3px solid rgb(var(--v-theme-primary));
  border-radius: 6px;
  box-sizing: border-box;
  pointer-events: none;
  /* 拖拽栏需高于目标高亮 */
  z-index: 999;
  animation: rich-text-drop-pulse 1s linear infinite;
}

@keyframes rich-text-drop-pulse {
  0% {
    opacity: 0.45;
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0.55);
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 0 4px rgba(var(--v-theme-primary), 0.18);
  }
  100% {
    opacity: 0.45;
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0.55);
  }
}

/* 落点线在 .canvas 内随 zoom 放大，所以粗细/圆角按视觉像素折算 */
.rich-text-drop-line {
  position: absolute;
  top: 0;
  left: 0;
  height: calc(3px / var(--canvas-zoom, 1));
  border-radius: calc(2px / var(--canvas-zoom, 1));
  background: rgb(var(--v-theme-primary));
  pointer-events: none;
  /* 拖拽栏需高于落点线 */
  z-index: 1000;
}

/* 预览框 z 由 addPreviewStyle 提供 */
.add-preview {
  position: absolute;
  border: 2px dashed rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  pointer-events: none;
  box-sizing: border-box;
}
.add-preview-label {
  position: absolute;
  top: -26px;
  left: -2px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-size: 12px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
}
/* 箭头用屏幕坐标，所以定位在容器层 */
.add-preview-arrow {
  position: absolute;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--v-theme-primary));
  pointer-events: none;
  z-index: 1002;
}

/* 已粘贴为主题色实底、未粘贴为灰图标 */
.snap-paperclip {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  /* 要压在描边环与手柄之上，所以置 Z_LAYER.paperclip */
  z-index: 1004;
  user-select: none;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.22);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  color: rgba(var(--v-theme-primary), 0.95);
  transition: background 0.12s, color 0.12s, transform 0.12s;
}
.snap-paperclip:hover {
  transform: translate(-50%, -50%) scale(1.15);
}
.snap-paperclip:not(.linked) {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.snap-paperclip.linked {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

/* 块内（编辑器输入/滚动/RO 改高）的布局变化不该向上传播到 .canvas 重排整画布，所以隔离布局与样式作用域；
   刻意不含 paint：会裁剪 RichTextEditor 用负边距外扩 64/80px 的左右 gutter（hover 命中与 popup 参考依赖它） */
.drag-wrapper {
  contain: layout style;
}

/* VDR 用内联 display 控制手柄，所以需 !important 覆盖 */
.drag-wrapper.popup-open :deep(.handle-tm) {
  display: none !important;
}

.block-container {
  height: 100%;
  width: 100%;
  position: relative;
  overflow: visible;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* outline 画在盒外会越界叠到邻块，所以用盒内 border */
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
}

/* 描边环已负责外框，所以 border 置透明（保留占位避免内容跳动） */
.drag-wrapper.selected .block-container {
  border-color: transparent;
}

.floating-handle {
  position: absolute;
  bottom: auto;
  /* 块重叠时拖拽栏不被盖住，所以置 Z_LAYER.dragHandle */
  z-index: 1001;
}

/* 未完成的滑出动画 transform 会把 handle 顶离固定位，所以拖拽期间禁用动画并归位 */
body.block-handle-dragging .floating-handle {
  transition: none !important;
  transform: none !important;
}

.drag-handle {
  position: absolute;
  height: 28px;
  display: flex;
  align-items: center;
  cursor: grab;
  /* 要实底不透明，所以用 surface 纯色 */
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  z-index: 16;
  padding: 0 10px;
  white-space: nowrap;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.2s;
  /* 贴边微调由内联 --handle-y 提供 */
  transform: translateY(var(--handle-y, -1px));
}

.drag-handle.handle-bottom {
  border-top: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 0 0 4px 4px;
}

.drag-handle:hover {
  /* surface-variant 混色难看，所以仅以主题色描边提示 */
  background: rgb(var(--v-theme-surface));
  border-color: rgb(var(--v-theme-primary));
}

.side-settings {
  position: absolute;
  height: 28px;
  display: flex;
  align-items: center;
  cursor: grab;
  /* 要实底不透明，所以用 surface 纯色 */
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  z-index: 16;
  padding: 0 4px;
  white-space: nowrap;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.2s;
  /* 贴边微调由内联 --handle-y 提供 */
  transform: translateY(var(--handle-y, -1px));
}
.side-settings.handle-bottom {
  border-top: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 0 0 4px 4px;
}
.side-settings:hover {
  /* surface-variant 混色难看，所以仅以主题色描边提示 */
  background: rgb(var(--v-theme-surface));
  border-color: rgb(var(--v-theme-primary));
}
.side-settings :deep(.v-btn) {
  height: 18px;
  width: 18px;
  min-width: 18px;
}

/* v-list-item__content 默认 overflow:hidden 会裁掉 switch 阴影，所以放开裁剪 */
:global(.auto-height-menu .v-list-item__content) {
  overflow: visible;
}

.left-handle {
  bottom: 100%;
  left: 10px;
}

.handle-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
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
  /* 要盖住块内滑出的手柄又不挡缩放手柄，所以取 15 */
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

/* 滑出方向由 handleBarStyle 的 --handle-slide 驱动 */
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