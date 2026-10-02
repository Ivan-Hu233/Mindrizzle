<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Z_LAYER } from './zIndex'

type Handle = 'tl' | 'tm' | 'tr' | 'ml' | 'mr' | 'bl' | 'bm' | 'br'

interface Rect {
  x: number
  y: number
  w: number
  h: number
  itemId?: string
}

interface ResizeSession {
  handle: string
  startClientX: number
  startClientY: number
  startRect: Rect
  lastRect: Rect
}

const props = withDefaults(defineProps<{
  itemId?: string
  x: number
  y: number
  w: number
  h: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number | null
  maxHeight?: number | null
  disabled?: boolean
  active?: boolean
  dragging?: boolean
  zIndex?: number
  handles?: string[]
  zoom?: number
}>(), {
  minWidth: 0,
  minHeight: 0,
  maxWidth: null,
  maxHeight: null,
  disabled: false,
  active: false,
  dragging: false,
  zIndex: 0,
  handles: () => ['tl', 'tm', 'tr', 'ml', 'mr', 'bl', 'bm', 'br'],
  zoom: 1,
})

const emit = defineEmits<{
  (e: 'resizestart', handle: string): void
  (e: 'resizing', x: number, y: number, w: number, h: number): void
  (e: 'resizestop', x: number, y: number, w: number, h: number): void
}>()

let session: ResizeSession | null = null

const rootEl = ref<HTMLElement | null>(null)
// 手柄在块边缘会被紧贴邻块盖住而点不到，所以 Teleport 到 .canvas 顶层（Z_LAYER.resizeHandle）
const canvasEl = ref<HTMLElement | null>(null)
onMounted(() => {
  canvasEl.value = rootEl.value?.closest('.canvas') ?? null
})

// .canvas 用 CSS zoom，所以渲染层圆整到视觉像素，逻辑仍用 content 坐标
const roundToPx = (v: number) => Math.round(v * props.zoom) / props.zoom
const renderRect = computed(() => ({
  x: roundToPx(props.x),
  y: roundToPx(props.y),
  w: roundToPx(props.w),
  h: roundToPx(props.h),
}))
// translate3d 会把块缓存为位图纹理、放大会上采样致文字发虚，所以用普通 translate
const boxStyle = computed(() => ({
  transform: `translate(${renderRect.value.x}px, ${renderRect.value.y}px)`,
  width: `${renderRect.value.w}px`,
  height: `${renderRect.value.h}px`,
  zIndex: props.zIndex,
}))
// 块拖拽期间坐标由画布命令式写入、本组件 prop 被冻结，手柄会冻在按下位置，所以拖拽期间不渲染
const showHandles = computed(() => props.active && !props.disabled && !props.dragging)

// .canvas 已应用 pan+origin，所以手柄直接用 content 坐标 + 边缘偏移
const HANDLE_POS: Record<Handle, (r: Rect) => { left: string; top: string }> = {
  tl: (r) => ({ left: `${r.x - 5}px`, top: `${r.y - 5}px` }),
  tm: (r) => ({ left: `${r.x + r.w / 2 - 4}px`, top: `${r.y - 5}px` }),
  tr: (r) => ({ left: `${r.x + r.w - 5}px`, top: `${r.y - 5}px` }),
  ml: (r) => ({ left: `${r.x - 5}px`, top: `${r.y + r.h / 2 - 4}px` }),
  mr: (r) => ({ left: `${r.x + r.w - 5}px`, top: `${r.y + r.h / 2 - 4}px` }),
  bl: (r) => ({ left: `${r.x - 5}px`, top: `${r.y + r.h - 5}px` }),
  bm: (r) => ({ left: `${r.x + r.w / 2 - 4}px`, top: `${r.y + r.h - 5}px` }),
  br: (r) => ({ left: `${r.x + r.w - 5}px`, top: `${r.y + r.h - 5}px` }),
}
const CURSOR: Record<Handle, string> = {
  tl: 'nw-resize', tm: 'n-resize', tr: 'ne-resize',
  ml: 'w-resize', mr: 'e-resize',
  bl: 'sw-resize', bm: 's-resize', br: 'se-resize',
}
const handleStyle = (h: string) => {
  const pos = HANDLE_POS[h as Handle](renderRect.value)
  return {
    // 手柄随 zoom 缩放，所以尺寸与定位圆整到整数视觉像素
    width: `${roundToPx(8)}px`,
    height: `${roundToPx(8)}px`,
    zIndex: Z_LAYER.resizeHandle,
    cursor: CURSOR[h as Handle],
    left: `${roundToPx(parseFloat(pos.left))}px`,
    top: `${roundToPx(parseFloat(pos.top))}px`,
  }
}

const clampW = (w: number) => Math.min(Math.max(w, props.minWidth), props.maxWidth ?? Infinity)
const clampH = (h: number) => Math.min(Math.max(h, props.minHeight), props.maxHeight ?? Infinity)

// 锚定边保持 content 坐标，拖 l/t 时 x/y 随尺寸调整
const computeRect = (s: ResizeSession, dx: number, dy: number): Rect => {
  const r = s.startRect
  let x = r.x
  let y = r.y
  let w = r.w
  let h = r.h
  if (s.handle.includes('r')) w = clampW(r.w + dx)
  if (s.handle.includes('l')) {
    w = clampW(r.w - dx)
    x = r.x + (r.w - w)
  }
  if (s.handle.includes('b')) h = clampH(r.h + dy)
  if (s.handle.includes('t')) {
    h = clampH(r.h - dy)
    y = r.y + (r.h - h)
  }
  return { x, y, w, h }
}

const onMove = (e: MouseEvent) => {
  if (!session) return
  // .canvas 用 zoom，所以鼠标位移需除以 zoom
  const rect = computeRect(session, (e.clientX - session.startClientX) / props.zoom, (e.clientY - session.startClientY) / props.zoom)
  session.lastRect = rect
  emit('resizing', rect.x, rect.y, rect.w, rect.h)
}

const onUp = () => {
  if (!session) return
  const rect = session.lastRect
  cleanup()
  emit('resizestop', rect.x, rect.y, rect.w, rect.h)
  session = null
}

// 会话以按下瞬间矩形 + 鼠标位移为基准，所以 autoPan 补偿改动 prop 不会进入反馈环
const onHandleDown = (handle: string, e: MouseEvent) => {
  if (props.disabled || e.button !== 0) return
  session = {
    handle,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startRect: { x: props.x, y: props.y, w: props.w, h: props.h },
    lastRect: { x: props.x, y: props.y, w: props.w, h: props.h },
  }
  // hover 自解析会 stopPropagation，所以用捕获阶段
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('mouseup', onUp)
  emit('resizestart', handle)
  e.preventDefault()
}

const cleanup = () => {
  window.removeEventListener('mousemove', onMove, true)
  window.removeEventListener('mouseup', onUp)
}
onUnmounted(cleanup)
</script>

<template>
  <div ref="rootEl" class="drag-wrapper resize-box" :style="boxStyle">
    <!-- 块无边框背景，用虚线框常驻标注内容区范围 -->
    <div class="content-guide" aria-hidden="true" />
    <slot />
    <!-- 手柄需固定视觉尺寸且不被邻块盖住，所以 Teleport 到 .canvas 顶层 -->
    <Teleport :to="canvasEl" :disabled="!canvasEl">
      <template v-if="showHandles">
        <div v-for="h in handles" :key="h" class="handle" :class="`handle-${h}`" :data-id="itemId"
          :style="handleStyle(h)" @mousedown.prevent.stop="onHandleDown(h, $event)" />
      </template>
    </Teleport>
  </div>
</template>

<style scoped>
.resize-box {
  position: absolute;
  box-sizing: border-box;
  touch-action: none;
}
.content-guide {
  position: absolute;
  inset: 0;
  /* 要可见又不挡操作，所以低对比度 + 穿透点击，层级高于块背景低于手柄 */
  opacity: 0.35;
  pointer-events: none;
  z-index: 10;
  box-sizing: border-box;
}
.handle {
  box-sizing: border-box;
  position: absolute;
  /* 明暗主题下都要与块背景有对比，所以用高对比边框 */
  background: rgb(var(--v-theme-background));
  border: 1px solid rgb(var(--v-theme-on-surface));
  box-shadow: 0 0 2px rgba(var(--v-theme-on-surface), 0.4);
  /* 与 Z_LAYER.resizeHandle 一致 */
  z-index: 1003;
}
@media only screen and (max-width: 768px) {
  [class*="handle-"]:before {
    content: '';
    left: -10px;
    right: -10px;
    bottom: -10px;
    top: -10px;
    position: absolute;
  }
}
</style>
