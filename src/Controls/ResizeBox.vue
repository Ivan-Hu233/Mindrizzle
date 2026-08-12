<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Z_LAYER } from './zIndex'

type Handle = 'tl' | 'tm' | 'tr' | 'ml' | 'mr' | 'bl' | 'bm' | 'br'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface ResizeSession {
  handle: string
  startClientX: number
  startClientY: number
  startRect: Rect
  lastRect: Rect
}

const props = withDefaults(defineProps<{
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
// 因手柄渲染在块边缘会被紧贴的邻块盖住而点不到，故 Teleport 到 .canvas 顶层
// （Z_LAYER.resizeHandle：高于选中块、曲别针与选中描边环）
const canvasEl = ref<HTMLElement | null>(null)
onMounted(() => {
  canvasEl.value = rootEl.value?.closest('.canvas') ?? null
})

// 因父 .canvas 被 scale(zoom)，content 坐标乘 zoom 落亚像素会致块边缘模糊，
// 故渲染层圆整到整数视觉像素（视觉 = round(content*zoom)），逻辑仍用原始 content
const roundToPx = (v: number) => Math.round(v * props.zoom) / props.zoom
const renderRect = computed(() => ({
  x: roundToPx(props.x),
  y: roundToPx(props.y),
  w: roundToPx(props.w),
  h: roundToPx(props.h),
}))
// 块定位用 translate3d 强制合成层（与 canvas 的 scale 组合为纯 scale + translate3d 渲染）
const boxStyle = computed(() => ({
  transform: `translate3d(${renderRect.value.x}px, ${renderRect.value.y}px, 0)`,
  width: `${renderRect.value.w}px`,
  height: `${renderRect.value.h}px`,
  zIndex: props.zIndex,
}))
const showHandles = computed(() => props.active && !props.disabled)

// 手柄定位：.canvas 已应用 pan+origin 变换，故用块 content 坐标 + 边缘偏移即可（与 floating-handle 同法）
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
    // 因手柄随 .canvas 的 scale(zoom) 缩放，尺寸与定位圆整到整数视觉像素避免边缘亚像素模糊
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

// 因锚定边（非手柄所在边）不随鼠标移动、保持 content 坐标，故拖 l/t 时 x/y 随尺寸调整
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
  // 因 .canvas 被 scale(zoom)，视口鼠标位移需除以 zoom 才等于 content 位移
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

// 因 resize 会话以"按下瞬间的矩形 + 鼠标位移"为基准（不依赖实时 prop），
// 故 autoPan 补偿（父组件改 prop）不会进入反馈环
const onHandleDown = (handle: string, e: MouseEvent) => {
  if (props.disabled || e.button !== 0) return
  session = {
    handle,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startRect: { x: props.x, y: props.y, w: props.w, h: props.h },
    lastRect: { x: props.x, y: props.y, w: props.w, h: props.h },
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  emit('resizestart', handle)
  e.preventDefault()
}

const cleanup = () => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
}
onUnmounted(cleanup)
</script>

<template>
  <div ref="rootEl" class="drag-wrapper resize-box" :style="boxStyle">
    <slot />
    <!-- 因手柄需固定视觉尺寸渲染（避开 .canvas 的 scale 缩放模糊）且不被邻块盖住，故 Teleport 到 .canvas-container 顶层用视觉坐标定位 -->
    <Teleport :to="canvasEl" :disabled="!canvasEl">
      <template v-if="showHandles">
        <div v-for="h in handles" :key="h" class="handle" :class="`handle-${h}`"
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
.handle {
  box-sizing: border-box;
  position: absolute;
  background: #ffffff;
  border: 1px solid #333;
  box-shadow: 0 0 2px #bbb;
  /* 与 Z_LAYER.resizeHandle 一致（CSS 无法引用 TS 常量） */
  z-index: 1002;
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
