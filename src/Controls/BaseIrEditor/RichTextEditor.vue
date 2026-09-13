<template>
  <div
    ref="wrapperRef"
    class="editor-wrapper"
    :class="{ compact: useCompact, 'auto-height': autoHeight }"
    :style="{
      color: 'var(--v-theme-on-surface)',
      background: 'var(--v-theme-surface)',
    }"
    @mousedown.stop
    @touchstart.stop
  >
    <ProseKit :editor="editor">
      <div class="editor-scroll-shell">
        <div ref="scrollRef" class="editor-scroll" @scroll="updateScrollMetrics">
          <div ref="editorMount" class="editor-mount" />
        </div>
        <div v-if="scrollMetrics.hasVertical" class="custom-scrollbar custom-scrollbar-vertical"
          @pointerdown="startVerticalScrollbar" @wheel="scrollVertical">
          <div class="custom-scrollbar-thumb" :style="verticalThumbStyle"
            @pointerdown.stop="startVerticalThumb" />
        </div>
        <div v-if="scrollMetrics.hasHorizontal" class="custom-scrollbar custom-scrollbar-horizontal"
          @pointerdown="startHorizontalScrollbar" @wheel="scrollHorizontal">
          <div class="custom-scrollbar-thumb" :style="horizontalThumbStyle"
            @pointerdown.stop="startHorizontalThumb" />
        </div>
      </div>
      <blockHandle :editor="editor" />
      <!-- .vdr 的 transform 祖先会使 fixed 定位基准偏移，teleport 到 body -->
      <Teleport to="body">
        <RowDropIndicator :editor="editor" />
      </Teleport>
    </ProseKit>
  </div>
</template>
<script lang="ts">
import type { ResizeConstraints } from '../resizeConstraints'

export const resizeConstraints: ResizeConstraints = {
  minWidth: 250,
  maxWidth: null,
  minHeight: 160,
  maxHeight: null,
}
</script>
<script setup lang="ts">
import 'prosekit/basic/style.css'
import 'prosekit/basic/typography.css'
import 'prosekit/pm/view/style/prosemirror.css'

import blockHandle from './extensions/block-handle.vue'
import RowDropIndicator from './extensions/RowDropIndicator.vue'
import { ref, onMounted, onUnmounted, computed, reactive, watch } from 'vue'
import { ProseKit, useDocChange } from '@prosekit/vue'
import { useDisplay } from 'vuetify'

import { defineExtension } from './extension.ts'
import { createEditor, NodeJSON } from '@prosekit/core'
import { getBlockRect } from './extensions/blockHandleUtils'

interface Props {
  dir?: 'ltr' | 'rtl'
  compact?: boolean
  doc?: NodeJSON | null
  autoHeight?: boolean
}
const props = defineProps<Props>()

const { xs } = useDisplay()
const isMobile = computed(() => xs.value)
const useCompact = computed(() => props.compact ?? isMobile.value)

const extension = defineExtension()
const editor = createEditor({ extension })
const editorMount = ref<HTMLDivElement>()
const wrapperRef = ref<HTMLDivElement>()
const scrollRef = ref<HTMLDivElement>()
const scrollMetrics = reactive({ scrollTop: 0, scrollLeft: 0, scrollHeight: 0, scrollWidth: 0, clientHeight: 0, clientWidth: 0, hasVertical: false, hasHorizontal: false })

const updateScrollMetrics = () => {
  const scroll = scrollRef.value
  if (!scroll) return
  Object.assign(scrollMetrics, {
    scrollTop: scroll.scrollTop,
    scrollLeft: scroll.scrollLeft,
    scrollHeight: scroll.scrollHeight,
    scrollWidth: scroll.scrollWidth,
    clientHeight: scroll.clientHeight,
    clientWidth: scroll.clientWidth,
    hasVertical: scroll.scrollHeight > scroll.clientHeight,
    hasHorizontal: scroll.scrollWidth > scroll.clientWidth,
  })
}

const verticalThumbStyle = computed(() => ({
  height: `${Math.max(24, scrollMetrics.clientHeight ** 2 / Math.max(scrollMetrics.scrollHeight, 1))}px`,
  transform: `translateY(${getThumbOffset('vertical')}px)`,
}))

const horizontalThumbStyle = computed(() => ({
  width: `${Math.max(24, scrollMetrics.clientWidth ** 2 / Math.max(scrollMetrics.scrollWidth, 1))}px`,
  transform: `translateX(${getThumbOffset('horizontal')}px)`,
}))

const getThumbOffset = (axis: 'vertical' | 'horizontal') => {
  const viewport = axis === 'vertical' ? scrollMetrics.clientHeight : scrollMetrics.clientWidth
  const content = axis === 'vertical' ? scrollMetrics.scrollHeight : scrollMetrics.scrollWidth
  const current = axis === 'vertical' ? scrollMetrics.scrollTop : scrollMetrics.scrollLeft
  const track = Math.max(viewport - 4, 0)
  const thumb = Math.max(24, viewport ** 2 / Math.max(content, 1))
  const maximumScroll = Math.max(content - viewport, 1)
  return (current / maximumScroll) * Math.max(track - thumb, 0)
}

const scrollVertical = (event: WheelEvent) => {
  event.preventDefault()
  event.stopPropagation()
  const scroll = scrollRef.value
  if (!scroll) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1
  scroll.scrollTop += event.deltaY * unit
}

const scrollHorizontal = (event: WheelEvent) => {
  event.preventDefault()
  event.stopPropagation()
  const scroll = scrollRef.value
  if (!scroll) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientWidth : 1
  scroll.scrollLeft += (event.deltaX || event.deltaY) * unit
}

const startVerticalScrollbar = (event: PointerEvent) => {
  if ((event.target as HTMLElement).classList.contains('custom-scrollbar-thumb')) return
  const scroll = scrollRef.value
  if (!scroll) return
  const track = event.currentTarget as HTMLElement
  const direction = event.clientY < track.getBoundingClientRect().top + getThumbOffset('vertical') ? -1 : 1
  scroll.scrollTop += direction * scroll.clientHeight
}

const startHorizontalScrollbar = (event: PointerEvent) => {
  if ((event.target as HTMLElement).classList.contains('custom-scrollbar-thumb')) return
  const scroll = scrollRef.value
  if (!scroll) return
  const track = event.currentTarget as HTMLElement
  const direction = event.clientX < track.getBoundingClientRect().left + getThumbOffset('horizontal') ? -1 : 1
  scroll.scrollLeft += direction * scroll.clientWidth
}

let scrollbarDrag: { axis: 'vertical' | 'horizontal'; start: number; scroll: number } | null = null
const startVerticalThumb = (event: PointerEvent) => startScrollbarDrag('vertical', event)
const startHorizontalThumb = (event: PointerEvent) => startScrollbarDrag('horizontal', event)
const startScrollbarDrag = (axis: 'vertical' | 'horizontal', event: PointerEvent) => {
  scrollbarDrag = { axis, start: axis === 'vertical' ? event.clientY : event.clientX, scroll: axis === 'vertical' ? scrollMetrics.scrollTop : scrollMetrics.scrollLeft }
  window.addEventListener('pointermove', moveScrollbarDrag)
  window.addEventListener('pointerup', stopScrollbarDrag, { once: true })
  event.preventDefault()
}
const moveScrollbarDrag = (event: PointerEvent) => {
  if (!scrollbarDrag || !scrollRef.value) return
  const scroll = scrollRef.value
  const delta = (scrollbarDrag.axis === 'vertical' ? event.clientY : event.clientX) - scrollbarDrag.start
  const viewport = scrollbarDrag.axis === 'vertical' ? scroll.clientHeight : scroll.clientWidth
  const content = scrollbarDrag.axis === 'vertical' ? scroll.scrollHeight : scroll.scrollWidth
  const next = scrollbarDrag.scroll + delta * content / Math.max(viewport, 1)
  if (scrollbarDrag.axis === 'vertical') scroll.scrollTop = next
  else scroll.scrollLeft = next
}
const stopScrollbarDrag = () => {
  scrollbarDrag = null
  window.removeEventListener('pointermove', moveScrollbarDrag)
}

// 画布拖组件入本块需先知道落点：按指针位置解析插入点与落点线 y（视口坐标），
// 规则同块内拖段落——按指针落在所在块的上下半区决定插到块前还是块后
function resolveDropAt(clientX: number, clientY: number): { pos: number; y: number } | null {
  const view = editor.view
  if (!view) return null
  const coords = view.posAtCoords({ left: clientX, top: clientY })
  if (!coords) return null
  const $pos = view.state.doc.resolve(coords.pos)
  if ($pos.depth === 0) return { pos: coords.pos, y: view.coordsAtPos(coords.pos)?.bottom ?? clientY }
  const before = $pos.before($pos.depth)
  const after = $pos.after($pos.depth)
  const rect = getBlockRect(view, before)
  const isBefore = !rect || clientY < rect.top + rect.height / 2
  const pos = isBefore ? before : after
  return { pos, y: rect ? (isBefore ? rect.top : rect.bottom) : view.coordsAtPos(pos)?.bottom ?? clientY }
}

// 画布拖拽中鼠标贴近块内上下边缘时需滚动块内内容，否则深处的落点看不到
function scrollContent(deltaY: number) {
  if (scrollRef.value) scrollRef.value.scrollTop += deltaY
}

// autoHeight 时块高需随内容实时调整，经块 id 上报内容高度给画布
const blockId = (): string | null => {
  let el: HTMLElement | null = wrapperRef.value ?? null
  while (el && !el.classList.contains('drag-wrapper')) el = el.parentElement
  return el?.getAttribute('data-id') ?? null
}
// 块高还需补 .content-area 上下 padding(8) 与 .editor-wrapper border(2)，共 10 content 单位
const AUTO_HEIGHT_EXTRA = 10
// auto-height 类解除了 .editor-scroll 的 height:100% 钳制（否则内容缩短时
// scrollHeight 仍等于块高、测量值不变），其 offsetHeight 即内容自然高度；
// 未开启 autoHeight 时不测量
const syncAutoHeight = () => {
  if (!props.autoHeight) return
  const id = blockId()
  const scrollEl = wrapperRef.value?.querySelector('.editor-scroll') as HTMLElement | null
  if (!id || !scrollEl) return
  const height = Math.ceil(scrollEl.offsetHeight + AUTO_HEIGHT_EXTRA)
  // 光标所在行在块内的 y（视觉像素、未缩放），供画布跟随输入滚动
  let cursorY = height
  const head = editor.view?.state.selection.head
  const wrapperRect = wrapperRef.value?.getBoundingClientRect()
  if (head != null && wrapperRect) {
    const coords = editor.view!.coordsAtPos(head)
    if (coords) cursorY = Math.min(Math.max(coords.bottom - wrapperRect.top, 0), height)
  }
  window.dispatchEvent(new CustomEvent('Mindrizzle:auto-height', { detail: { id, height, cursorY } }))
}

// 因组件 width/height 由 attr 驱动，改 attr 未必改变内容容器自身盒子，
// 故 doc change 后再补测一次（rAF 合并同帧多次事务）
let metricsFrame = 0
const scheduleScrollMetrics = () => {
  if (metricsFrame) return
  metricsFrame = requestAnimationFrame(() => {
    metricsFrame = 0
    updateScrollMetrics()
  })
}

// autoHeight 需文档编辑时实时跟随块高，监听 doc change（内部按开关与否跳过）
useDocChange(() => {
  syncAutoHeight()
  scheduleScrollMetrics()
}, { editor })

// 仅 zoom 变化会重排内容（宽变→高变），pan 纯平移无需重测（否则拖动画布时每帧测量会卡顿），仅 zoom 变化时重测
let lastTransformZoom: number | null = null
const onCanvasTransform = (e: Event) => {
  const z = (e as CustomEvent<{ zoom?: number }>).detail?.zoom
  if (z == null || z === lastTransformZoom) return
  lastTransformZoom = z
  requestAnimationFrame(() => syncAutoHeight())
}

onMounted(() => {
  // 因 .editor-scroll 高度固定，插入组件只撑大内容容器、不改变其自身盒子，
  // 故独占观测 scrollRef 会漏掉内容增高，必须一并观测 editorMount 才能刷新 thumb 与显隐
  const observer = new ResizeObserver(updateScrollMetrics)
  if (scrollRef.value) observer.observe(scrollRef.value)
  if (editorMount.value) {
    editor.mount(editorMount.value)
    observer.observe(editorMount.value)
    if (isMobile.value) {
      // view.focus() 不带 preventScroll，聚焦 ProseMirror 根 DOM 触发默认滚动
      // 会把 overflow:hidden 的画布容器滚出偏移，直接对根 DOM 用 preventScroll 聚焦
      setTimeout(() => (editor.view?.dom as HTMLElement | undefined)?.focus({ preventScroll: true }), 100)
    }
    if (props.doc) {
      editor.setContent(props.doc)
    }
    // 内容渲染需在 mount/setContent 完成后才可测量，rAF 后测一次
    requestAnimationFrame(() => {
      updateScrollMetrics()
      syncAutoHeight()
    })
  }
  window.addEventListener('Mindrizzle:canvas-transform', onCanvasTransform)
  onUnmounted(() => observer.disconnect())
})

onUnmounted(() => {
  if (metricsFrame) cancelAnimationFrame(metricsFrame)
  metricsFrame = 0
  stopScrollbarDrag()
  editor.unmount()
  window.removeEventListener('Mindrizzle:canvas-transform', onCanvasTransform)
})

// 切换开关时需立即按当前内容调整块高，开启瞬间测一次
watch(() => props.autoHeight, (v) => {
  if (v) requestAnimationFrame(() => syncAutoHeight())
})

function importJSON(json: NodeJSON) {
  editor.setContent(json)
}

watch(() => props.doc, (v) => {
  if (v) editor.setContent(v as NodeJSON)
})

defineExpose({
  commands: editor.commands,
  doc: editor.state.doc,
  importJSON,
  resolveDropAt,
  scrollContent,
  getDocJSON() {
    return editor.state.doc.toJSON()
  },
  // 父组件需统一调用保存/加载而不按组件类型特判，暴露统一的 saveConfig/loadConfig
  saveConfig() {
    return { content: editor.state.doc.toJSON() }
  },
  loadConfig(config: { content?: NodeJSON | null }) {
    if (config?.content) editor.setContent(config.content as NodeJSON)
  },
})
</script>

<style scoped>
.editor-wrapper {
  position: relative;
  border: 1px solid transparent;
  border-radius: 4px;
  margin: 0px;
  /* 需为 block-handle popup 预留左右 gutter 显示区，用负边距扩展；
     overflow:visible 让 popup 进入 gutter 而不触发滚动条 */
  margin-left: -64px;
  margin-right: -80px;
  padding-left: 64px;
  padding-right: 80px;
  width: 100%;
  box-sizing: content-box;
  
  height: 100%;
  overflow: visible;
  transition: border-color 0.15s ease;
  touch-action: auto; /* 需保证触摸滚动正常，设为 auto */
  /* popup 已 Teleport 到 .canvas、左右 gutter 仅为视觉留白，若保留命中会拦截
     该区域的画布左键框选，整体穿透；内容区/设置按钮单独恢复 pointer-events */
  pointer-events: none;
}

/* 滚动条需紧贴文本区右侧、不被 popup gutter 偏移，滚动容器宽度与文本区一致（不进 gutter） */
.editor-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  scrollbar-width: none;
  box-sizing: border-box;
  pointer-events: auto;
}
.editor-scroll::-webkit-scrollbar {
  display: none;
}

.editor-scroll-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.editor-wrapper.auto-height .editor-scroll-shell {
  height: auto;
}

.custom-scrollbar {
  position: absolute;
  z-index: 6;
  pointer-events: auto;
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 4px;
  opacity: 0.7;
  touch-action: none;
}

.custom-scrollbar:hover {
  opacity: 1;
}

.custom-scrollbar-vertical {
  top: 2px;
  right: 2px;
  bottom: 2px;
  width: 8px;
}

.custom-scrollbar-horizontal {
  right: 2px;
  bottom: 2px;
  left: 2px;
  height: 8px;
}

.custom-scrollbar-thumb {
  position: absolute;
  pointer-events: auto;
  background: rgba(var(--v-theme-on-surface), 0.42);
  border-radius: 4px;
  cursor: grab;
}

.custom-scrollbar-thumb:active {
  cursor: grabbing;
  background: rgba(var(--v-theme-on-surface), 0.62);
}

.custom-scrollbar-vertical .custom-scrollbar-thumb {
  top: 0;
  right: 0;
  left: 0;
}

.custom-scrollbar-horizontal .custom-scrollbar-thumb {
  top: 0;
  bottom: 0;
  left: 0;
}

/* auto-height 需量取内容自然高度（否则被 height:100% 钳制到块高、缩短时测不到），
   解除钳制让容器随内容撑开，块高 = 内容 + 固定开销 */
.editor-wrapper.auto-height .editor-scroll {
  height: auto;
}

.editor-wrapper.compact {
  margin-left: 0;
  margin-right: 0;
  margin-top: -44px;
  width: 100%;
  padding: 44px 0 0 0;
  box-sizing: border-box;
  /* 移动端首行上方的 popup 需 44px 空间才不被 overflow:auto 裁剪，顶部留白 */
}

.editor-mount {
  outline: none;
  /* 固定 100% 高度时底部行会被 ProseKit hover 判定为不在 view.dom 内而无法弹 popup，高度随内容增长 */
  min-height: 100%;
  width: 100%;
  pointer-events: auto;
}

.editor-mount:focus-within {
  border-color: rgb(var(--v-theme-primary));
}

.editor-mount :deep(.ProseMirror) {
  padding: 0;
  outline: none;
  height: 100%;
  /* 块随 zoom 重排版放大，固定 min-height 按 --canvas-zoom 缩放保持协调 */
  min-height: calc(100px * var(--canvas-zoom, 1));
  pointer-events: auto;
  touch-action: auto;
}

/* 需保证强制移动端/紧凑模式同样生效，直接绑定 compact 类而非用媒体查询 */
.editor-wrapper.compact :deep(.block-handle-popup) {
  transform: translateY(var(--block-handle-shift, 0px)) scale(1.1);
  transform-origin: center bottom;
}
/* bottom 放置需向下展开，缩放原点改为顶部 */
.editor-wrapper.compact :deep(.block-handle-positioner.placement-bottom .block-handle-popup) {
  transform-origin: center top;
}

/* 放大仅针对移动端 compact，桌面端 top/bottom 退化时保持正常大小、仅应用垂直裁剪补偿 */
.editor-wrapper:not(.compact) :deep(.block-handle-positioner.placement-top .block-handle-popup),
.editor-wrapper:not(.compact) :deep(.block-handle-positioner.placement-bottom .block-handle-popup) {
  transform: translateY(var(--block-handle-shift, 0px));
}
.editor-wrapper.compact :deep(.block-handle-btn) {
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
}
.editor-wrapper.compact :deep(.block-handle-btn svg) {
  width: 22px;
  height: 22px;
}
</style>