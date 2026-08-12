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
      <div class="editor-scroll">
        <div ref="editorMount" class="editor-mount" />
      </div>
      <blockHandle :editor="editor" />
      <!-- 因 .vdr 的 transform 祖先会使 fixed 定位基准偏移，故 teleport 到 body -->
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
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ProseKit, useDocChange } from '@prosekit/vue'
import { useDisplay } from 'vuetify'

import { defineExtension } from './extension.ts'
import { createEditor, NodeJSON } from '@prosekit/core'

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

// 因 autoHeight 时块高需随内容实时调整，故经块 id 上报内容高度给画布
const blockId = (): string | null => {
  let el: HTMLElement | null = wrapperRef.value ?? null
  while (el && !el.classList.contains('drag-wrapper')) el = el.parentElement
  return el?.getAttribute('data-id') ?? null
}
// 因块高还需补 .content-area 上下 padding(8) 与 .editor-wrapper border(2)，共 10 content 单位
const AUTO_HEIGHT_EXTRA = 10
// 因 auto-height 类解除了 .editor-scroll 的 height:100% 钳制（否则内容缩短时
// scrollHeight 仍等于块高、测量值不变），故其 offsetHeight 即内容自然高度；
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
  window.dispatchEvent(new CustomEvent('omnijot:auto-height', { detail: { id, height, cursorY } }))
}

// 因 autoHeight 需文档编辑时实时跟随块高，故监听 doc change（内部按开关与否跳过）
useDocChange(() => syncAutoHeight(), { editor })

// 因仅 zoom 变化会重排内容（宽变→高变），pan 纯平移无需重测（否则拖动画布时每帧测量会卡顿），故仅 zoom 变化时重测
let lastTransformZoom: number | null = null
const onCanvasTransform = (e: Event) => {
  const z = (e as CustomEvent<{ zoom?: number }>).detail?.zoom
  if (z == null || z === lastTransformZoom) return
  lastTransformZoom = z
  requestAnimationFrame(() => syncAutoHeight())
}

onMounted(() => {
  if (editorMount.value) {
    editor.mount(editorMount.value)
    if (isMobile.value) {
      // 因 view.focus() 不带 preventScroll，聚焦 ProseMirror 根 DOM 触发默认滚动
      // 会把 overflow:hidden 的画布容器滚出偏移，故直接对根 DOM 用 preventScroll 聚焦
      setTimeout(() => (editor.view?.dom as HTMLElement | undefined)?.focus({ preventScroll: true }), 100)
    }
    if (props.doc) {
      editor.setContent(props.doc)
    }
    // 因内容渲染需在 mount/setContent 完成后才可测量，故 rAF 后测一次
    requestAnimationFrame(() => syncAutoHeight())
  }
  window.addEventListener('omnijot:canvas-transform', onCanvasTransform)
})

onUnmounted(() => {
  editor.unmount()
  window.removeEventListener('omnijot:canvas-transform', onCanvasTransform)
})

// 因切换开关时需立即按当前内容调整块高，故开启瞬间测一次
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
  getDocJSON() {
    return editor.state.doc.toJSON()
  },
  // 因父组件需统一调用保存/加载而不按组件类型特判，故暴露统一的 saveConfig/loadConfig
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
  /* 因需为 block-handle popup 预留左右 gutter 显示区，故用负边距扩展；
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
  touch-action: auto; /* 因需保证触摸滚动正常，故设为 auto */
  /* 因 popup 已 Teleport 到 .canvas、左右 gutter 仅为视觉留白，若保留命中会拦截
     该区域的画布左键框选，故整体穿透；内容区/设置按钮单独恢复 pointer-events */
  pointer-events: none;
}

/* 因滚动条需紧贴文本区右侧、不被 popup gutter 偏移，故滚动容器宽度与文本区一致（不进 gutter） */
.editor-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  pointer-events: auto;
}

/* 因 auto-height 需量取内容自然高度（否则被 height:100% 钳制到块高、缩短时测不到），
   故解除钳制让容器随内容撑开，块高 = 内容 + 固定开销 */
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
  /* 因移动端首行上方的 popup 需 44px 空间才不被 overflow:auto 裁剪，故顶部留白 */
}

.editor-mount {
  outline: none;
  /* 因固定 100% 高度时底部行会被 ProseKit hover 判定为不在 view.dom 内而无法弹 popup，故高度随内容增长 */
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
  /* 因块随 zoom 重排版放大，固定 min-height 按 --canvas-zoom 缩放保持协调 */
  min-height: calc(100px * var(--canvas-zoom, 1));
  pointer-events: auto;
  touch-action: auto;
}

/* 因需保证强制移动端/紧凑模式同样生效，故直接绑定 compact 类而非用媒体查询 */
.editor-wrapper.compact :deep(.block-handle-popup) {
  transform: translateY(var(--block-handle-shift, 0px)) scale(1.1);
  transform-origin: center bottom;
}
/* 因 bottom 放置需向下展开，故缩放原点改为顶部 */
.editor-wrapper.compact :deep(.block-handle-positioner.placement-bottom .block-handle-popup) {
  transform-origin: center top;
}

/* 因放大仅针对移动端 compact，故桌面端 top/bottom 退化时保持正常大小、仅应用垂直裁剪补偿 */
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