<script setup lang="ts">
import { mdiPlus, mdiDragVerticalVariant } from '@mdi/js'
import {
  BlockHandleAdd,
  BlockHandleDraggable,
  BlockHandlePopup,
  BlockHandlePositioner,
  BlockHandleRoot,
} from 'prosekit/vue/block-handle'
import type { Editor } from '@prosekit/core'
import { ref, onUnmounted, computed, watch } from 'vue'
import { NodeSelection } from 'prosekit/pm/state'

interface Props {
  dir?: 'ltr' | 'rtl'
  editor?: Editor | null
}

const props = defineProps<Props>()

// 当前 hover 到的块（由 BlockHandleRoot 的 stateChange 事件提供）。
// hover 离开时会触发 detail=null，但为了拖拽需要在鼠标移到手柄时仍能拿到被拖块，
// 因此只在有值时更新（保留最后一次 hover 的块）。
const hoveredBlock = ref<{ node: unknown; pos: number } | null>(null)
// 跟随真实 hover 状态（含离开时的 null），用于驱动移动端“行上侧高亮”
const activeHover = ref<{ node: unknown; pos: number } | null>(null)
function onBlockStateChange(event: Event) {
  const detail = (event as CustomEvent).detail
  activeHover.value = detail
  if (detail) hoveredBlock.value = detail
}

// ---------- 移动端行高亮 ----------
// 给 popup 所应用的行（块）整行加淡色背景高亮 + 上侧强调，作为 popup 与该行的视觉连接。
// 相比单纯的顶部细线更直观、不易误解（细线容易被当成光标/滚动条之类）。
// 注意：不能给 ProseMirror 块元素加 class——会触发 PM mutation observer 重渲染，
// 导致 popup 参考元素的 DOM 被替换/断开、popup 定位失效（飞到屏幕外）。
// 所以这里只“读”块的 rect，用 teleport 到 body 的 fixed 元素来画高亮。
const highlightRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const highlightStyle = computed(() => {
  if (!highlightRect.value) return {}
  const { left, top, width, height } = highlightRect.value
  return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }
})

// 拖拽中不显示高亮，避免与拖拽的选区框（NodeSelection 外框）重叠
const isDragging = ref(false)

// 鼠标快速移出编辑器时，高亮/popup 不应延迟消失：
// ProseKit 的 hover 扩展有 200ms throttle + 180ms 失效缓冲（共约 380ms 才清 hoverState）。
// 这里监听编辑器内容 DOM 的 pointerleave，鼠标真正离开时在短缓冲后立即清除。
// 短缓冲是为了给“从块移到 popup（两者之间有间隙）”留时间，避免直接清导致闪烁。
let editorLeaveBound = false
let editorLeaveTimer: any = null
function onEditorPointerLeave() {
  if (editorLeaveTimer) return
  editorLeaveTimer = setTimeout(() => {
    editorLeaveTimer = null
    // 立即清除高亮（不等 ProseKit 的 state-change）
    highlightRect.value = null
    // 立即关闭 popup（跳过 ProseKit 的 throttle + 缓冲延迟）
    const poser = findPositionerElement()
    if (poser) {
      const store = getBlockHandleStore(poser)
      store?.hoverState?.set(undefined)
    }
  }, 100)
}
function cancelEditorLeave() {
  if (editorLeaveTimer) {
    clearTimeout(editorLeaveTimer)
    editorLeaveTimer = null
  }
}
function findPositionerElement(): HTMLElement | null {
  let view: any = null
  try {
    view = props.editor?.view
  } catch {
    view = null
  }
  if (!view?.dom) return null
  const wrapper = (view.dom as HTMLElement).closest('.editor-wrapper')
  return wrapper ? wrapper.querySelector('.block-handle-positioner') : null
}
function ensureEditorLeaveListener(view: any) {
  if (editorLeaveBound || !view?.dom) return
  editorLeaveBound = true
  view.dom.addEventListener('pointerleave', onEditorPointerLeave)
}

watch(activeHover, () => {
  highlightRect.value = null
  const hover = activeHover.value
  if (!hover) return

  let view: any = null
  try {
    view = props.editor?.view
  } catch {
    view = null
  }
  if (!view?.dom) return
  ensureEditorLeaveListener(view)
  cancelEditorLeave()
  // 仅移动端（compact 模式）高亮行
  if (!(view.dom as HTMLElement).closest('.editor-wrapper.compact')) return

  let blockEl: HTMLElement | null = null
  try {
    blockEl = view.nodeDOM(hover.pos) as HTMLElement | null
  } catch {
    blockEl = null
  }
  if (!blockEl || typeof blockEl.getBoundingClientRect !== 'function') return
  const r = blockEl.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return
  highlightRect.value = { left: r.left, top: r.top, width: r.width, height: r.height }
})

// ---------- 手柄显示方向 ----------
// 桌面端：根据所在 VueDraggableResizable（.drag-wrapper）相对画布（.canvas）的
// 水平位置决定 popup 显示在行的左侧还是右侧——块在画布左半 → 显示在行右侧；
// 右半 → 显示在行左侧（popup 始终朝向画布内侧，避免被画布/容器边缘裁剪）。
// 移动端（RichTextEditor 处于 compact 模式）：popup 显示在行上方。
const handlePlacement = computed<'left' | 'right' | 'top'>(() => {
  const fallback: 'left' | 'right' = props.dir === 'rtl' ? 'right' : 'left'
  // 依赖 hoveredBlock：每次 hover 变化时重新计算（拖动/移动块后方向仍正确）
  if (!hoveredBlock.value) return fallback

  // 编辑器可能尚未挂载（view 访问会抛 “Editor is not mounted”），需保护
  let editorDom: HTMLElement | null = null
  try {
    editorDom = props.editor?.view?.dom as HTMLElement | null
  } catch {
    editorDom = null
  }

  // 移动端：行上方
  if (editorDom?.closest('.editor-wrapper.compact')) return 'top'

  // 桌面端：按画布水平位置决定左右
  const widget = editorDom?.closest('.drag-wrapper') as HTMLElement | null
  const canvas = editorDom?.closest('.canvas') as HTMLElement | null
  if (!widget || !canvas) return fallback
  const widgetRect = widget.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()
  const widgetCenter = widgetRect.left + widgetRect.width / 2
  const canvasCenter = canvasRect.left + canvasRect.width / 2
  return widgetCenter < canvasCenter ? 'right' : 'left'
})

// 鼠标进入 popup（手柄）时保持显示：ProseKit 会在 hoverState 失效（约 180ms
// 缓冲）后自动关闭 popup，导致鼠标一移到手柄上 popup 就消失、无法点击/拖拽。
// 这里在鼠标进入 popup 时：1) 用 popupKeep + CSS 强制保持可见；2) 通过 aria-ui
// context 拿到 ProseKit 的 BlockHandleStore 并恢复 hoverState，让 ADD/拖拽可用。
const popupKeep = ref(false)
let cachedStore: any = null

function getBlockHandleStore(el?: any): any {
  if (cachedStore) return cachedStore
  if (!el) return null
  // aria-ui context 通过 'aria-ui:context-request' 冒泡事件向上找 provider，
  // provider 会用 event.callback(value) 把 BlockHandleStore 传回。
  let store: any
  const ev: any = new Event('aria-ui:context-request', { bubbles: true, composed: true })
  ev.key = 'aria-ui:context:prosekit-block-handle-store'
  ev.callback = (value: any) => { store = value }
  el.dispatchEvent(ev)
  if (store) cachedStore = store
  return store
}

function onPopupEnter() {
  // 鼠标进入 popup（手柄）：取消“移出编辑器”的待清除定时，保留高亮与 popup
  cancelEditorLeave()
  popupKeep.value = true
  startKeepAlive()
}
function onPopupLeave(e: Event) {
  popupKeep.value = false
  stopKeepAlive()
  const store = getBlockHandleStore(e.target)
  if (store) {
    // 避免 hoverState 残留导致 popup 一直显示。
    store.hoverState.set(undefined)
  }
}

let keepAliveTimer: any = null
/** 向最后一个 hover 的块派发假的 pointermove，让 ProseKit 的 hover 扩展恢复 hoverState。 */
function refreshHoverState() {
  const block = hoveredBlock.value
  const view = props.editor?.view
  if (!block || !view) return
  const dom = view.nodeDOM((block as any).pos) as HTMLElement | null
  if (dom && typeof dom.getBoundingClientRect === 'function') {
    const r = dom.getBoundingClientRect()
    dom.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: r.x + 2,
        clientY: r.y + r.height / 2,
        pointerId: 1,
      }),
    )
  }
}
function startKeepAlive() {
  stopKeepAlive()
  refreshHoverState()
  keepAliveTimer = setInterval(refreshHoverState, 150)
}
function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
}

/** 通过鼠标坐标找到鼠标所在的编辑器实例（支持跨编辑器拖拽）。 */
function findEditorAt(x: number, y: number): Editor | null {
  const el = document.elementFromPoint(x, y)
  if (!el || !el.closest) return null
  const pm = el.closest('.ProseMirror')
  if (!pm) return null
  let comp = (pm as any).__vueParentComponent
  let n = comp
  while (n) {
    if (n.setupState && n.setupState.editor) return n.setupState.editor as Editor
    n = n.parent
  }
  return null
}

// ---- 自定义拖拽（pointer 事件驱动，兼容 WebKitGTK 的 HTML5 DnD 缺陷）----
// WebKitGTK（Tauri Linux 默认 webview）对 HTML5 拖拽的 dragover/drop 支持不完整：
// dragstart 能触发，但 dragover/drop 事件不会正常派发 → 没有 drop indicator、
// drop 后也无法插入。所以这里完全不依赖 HTML5 DnD，改用 pointerdown/mousemove/
// mouseup 自己完成拖拽、指示器和插入，在任意 webview 下都可靠。
let dragging = false
let dragSource: { editor: Editor; node: any; from: number; to: number } | null = null
let ghostEl: HTMLElement | null = null
let indicatorEl: HTMLElement | null = null

/** 按下拖拽手柄：开始自定义拖拽。 */
function onDragPointerDown(e: PointerEvent) {
  const editor = props.editor
  const block = hoveredBlock.value
  const view = editor?.view
  if (!view || !block) return
  const node = block.node as any
  if (!node) return
  // 阻止原生 HTML5 拖拽（preventDefault 会阻止 draggable 元素启动 dragstart）
  e.preventDefault()
  e.stopPropagation()
  // 选中节点（保持点击手柄选中块的行为）
  try {
    const nodeSelection = NodeSelection.create(view.state.doc, block.pos)
    view.dispatch(view.state.tr.setSelection(nodeSelection))
  } catch { /* noop */ }
  // 记录拖拽源
  dragSource = { editor, node, from: block.pos, to: block.pos + node.nodeSize }
  dragging = true
  // 拖拽期间隐藏行高亮，避免与拖拽选区框重叠
  isDragging.value = true
  highlightRect.value = null
  createDragGhost(node, e.clientX, e.clientY)
  // window 级监听：pointermove 在任意浏览器（含 WebKitGTK）都稳定触发；
  // 注意 mouse.down 后部分环境（含自动化）不再派发 mousemove，所以用 pointermove。
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragUp)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(e: MouseEvent) {
  if (!dragging || !dragSource) return
  // 更新拖拽 ghost 位置
  if (ghostEl) {
    ghostEl.style.left = `${e.clientX + 10}px`
    ghostEl.style.top = `${e.clientY + 10}px`
  }
  // 根据鼠标位置在目标编辑器上显示指示器
  const targetEditor = findEditorAt(e.clientX, e.clientY)
  if (targetEditor) {
    const insertPos = findDropPos(targetEditor.view, e.clientX, e.clientY)
    updateIndicator(targetEditor.view, insertPos)
  } else {
    hideIndicator()
  }
}

function onDragUp(e: MouseEvent) {
  if (!dragging || !dragSource) return
  const targetEditor = findEditorAt(e.clientX, e.clientY)
  if (targetEditor) {
    if (targetEditor === dragSource.editor) {
      moveBlockInSameEditor(dragSource, targetEditor.view, e.clientX, e.clientY)
    } else {
      moveBlockAcrossEditors(dragSource, targetEditor, e.clientX, e.clientY)
    }
  }
  cleanupDrag()
}

/** 同编辑器内移动：删除源块后把节点插到目标位置（用 tr.mapping 修正位置）。 */
function moveBlockInSameEditor(
  source: { editor: Editor; node: any; from: number; to: number },
  view: any,
  clientX: number,
  clientY: number,
) {
  const insertPos0 = findDropPos(view, clientX, clientY)
  const tr = view.state.tr
  tr.delete(source.from, source.to)
  const insertPos = tr.mapping.map(insertPos0)
  const targetNode = view.state.schema.nodeFromJSON(source.node.toJSON())
  tr.insert(insertPos, targetNode)
  view.dispatch(tr)
  view.focus()
}

/**
 * 计算目标编辑器的插入位置：用鼠标 y 与鼠标所在块的 DOM rect 中心比较，
 * 决定插到块前（before）还是块后（after）。与行级 dropIndicator 显示的
 * 位置完全一致（indicator 显示在对应块的 top/bottom），所见即所得。
 */
function findDropPos(view: any, x: number, y: number): number {
  const coords = view.posAtCoords({ left: x, top: y })
  if (!coords) return view.state.doc.content.size
  const $pos = view.state.doc.resolve(coords.pos)
  if ($pos.depth === 0) return coords.pos
  const before = $pos.before($pos.depth)
  const after = $pos.after($pos.depth)
  const dom = view.nodeDOM(before) as HTMLElement | null
  if (dom && typeof dom.getBoundingClientRect === 'function') {
    const r = dom.getBoundingClientRect()
    return y < r.top + r.height / 2 ? before : after
  }
  return coords.pos - before < after - coords.pos ? before : after
}

function moveBlockAcrossEditors(
  source: { editor: Editor; node: any; from: number; to: number },
  targetEditor: Editor,
  clientX: number,
  clientY: number,
) {
  const tgtView = targetEditor.view
  // 用与 dropIndicator 相同的算法计算插入位置（最近的块边界）
  const insertPos = findDropPos(tgtView, clientX, clientY)
  // 1) 源编辑器删除被拖块
  const srcView = source.editor.view
  const delTr = srcView.state.tr
  delTr.delete(source.from, source.to)
  srcView.dispatch(delTr)
  // 2) 目标编辑器插入到计算好的位置（节点需转换到目标 schema）
  // 注意：每个编辑器的 schema 是独立构建的，直接插入源节点会静默失败
  const targetNode = tgtView.state.schema.nodeFromJSON(source.node.toJSON())
  const insTr = tgtView.state.tr
  insTr.insert(insertPos, targetNode)
  tgtView.dispatch(insTr)
  tgtView.focus()
}

function cleanupDrag() {
  if (!dragging) return
  dragging = false
  isDragging.value = false
  dragSource = null
  removeGhost()
  removeIndicator()
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
  window.removeEventListener('pointerup', onDragUp)
}

/** 创建跟随鼠标的拖拽 ghost（块预览）。 */
function createDragGhost(node: any, x: number, y: number) {
  removeGhost()
  ghostEl = document.createElement('div')
  // 简洁的“蓝框 + 文字”预览：不用整块克隆（整块是满宽、带白色半透明背景，
  // 跟随鼠标会回流导致鬼畜），改为纯文本 + 固定最大宽度不回流，
  // 蓝框样式与 ProseMirror 的 NodeSelection（.ProseMirror-selectednode）一致。
  ghostEl.style.cssText = [
    'position:fixed;pointer-events:none;z-index:9999;',
    'background:transparent;',
    'outline:2px solid #8cf;',
    'border-radius:3px;',
    'padding:3px 10px;',
    'max-width:280px;',
    'white-space:pre-wrap;',
    'word-break:break-word;',
    'overflow:hidden;',
    'box-sizing:border-box;',
  ].join('')
  ghostEl.textContent = node.textContent || ' '
  document.body.appendChild(ghostEl)
  ghostEl.style.left = `${x + 12}px`
  ghostEl.style.top = `${y + 12}px`
}
function removeGhost() {
  if (ghostEl) {
    ghostEl.remove()
    ghostEl = null
  }
}

/** 在目标编辑器的插入位置显示全局指示器（position:fixed，viewport 坐标）。 */
function updateIndicator(view: any, insertPos: number) {
  if (!indicatorEl) {
    indicatorEl = document.createElement('div')
    indicatorEl.style.cssText =
      'position:fixed;pointer-events:none;height:2px;' +
      'background:rgba(var(--v-theme-primary),0.9);z-index:9998;left:0;top:0;'
    document.body.appendChild(indicatorEl)
  }
  const domRect = view.dom.getBoundingClientRect()
  const coords = view.coordsAtPos(insertPos)
  const y = coords ? coords.bottom : domRect.top
  indicatorEl.style.display = 'block'
  indicatorEl.style.width = `${Math.max(2, Math.round(domRect.width))}px`
  indicatorEl.style.transform = `translate(${Math.round(domRect.left)}px, ${Math.round(y - 1)}px)`
}
function hideIndicator() {
  if (indicatorEl) indicatorEl.style.display = 'none'
}
function removeIndicator() {
  if (indicatorEl) {
    indicatorEl.remove()
    indicatorEl = null
  }
}

onUnmounted(() => {
  stopKeepAlive()
  cleanupDrag()
  cancelEditorLeave()
  if (editorLeaveBound) {
    try {
      const view = props.editor?.view
      view?.dom?.removeEventListener('pointerleave', onEditorPointerLeave)
    } catch { /* noop */ }
  }
})
</script>

<template>
  <BlockHandleRoot @state-change="onBlockStateChange">
    <BlockHandlePositioner
      :placement="handlePlacement"
      :class="['block-handle-positioner', `placement-${handlePlacement}`]"
    ><!--TODO 未来或许可以把这个单独分离出来成为一个窗口?-->
      <BlockHandlePopup
        class="block-handle-popup"
        :class="{ 'popup-keep': popupKeep }"
        @pointerenter="onPopupEnter"
        @pointerleave="onPopupLeave"
      >
        <BlockHandleAdd class="block-handle-btn">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
          >
            <path :d="mdiPlus" />
          </svg>
        </BlockHandleAdd>
        <BlockHandleDraggable
          class="block-handle-btn block-handle-drag"
          @pointerdown.prevent="onDragPointerDown"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
          >
            <path :d="mdiDragVerticalVariant" />
          </svg>
        </BlockHandleDraggable>
      </BlockHandlePopup>
    </BlockHandlePositioner>
  </BlockHandleRoot>

  <!-- 移动端行高亮：teleport 到 body，避免被 .vdr transform / overflow 裁剪 -->
  <Teleport to="body">
    <div v-if="highlightRect && !isDragging" class="block-handle-line-highlight" :style="highlightStyle" />
  </Teleport>
</template>

<style scoped>
.block-handle-positioner {
  display: block;
  overflow: visible;
  width: min-content;
  height: min-content;
  z-index: 50;
  transition: transform 0.1s ease-out;
  pointer-events: none;
  inset: auto;
  margin-left: 8px;
}

/* right / top 放置时不需要抵消 -8px（floating-ui 的 translate 为正值或垂直方向） */
.block-handle-positioner.placement-right{
  margin-right: 8px;
}
.block-handle-positioner.placement-top {
  margin-left: 0;
  margin-top: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .block-handle-positioner {
    transition: none;
  }
}

.block-handle-popup {
  background-color: rgba(var(--v-theme-primary), 0.06);
  border-radius: 6px;
  margin-right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  pointer-events: auto;
  box-sizing: border-box;
  transition: opacity 0.1s, scale 0.1s;
  transform-origin: var(--transform-origin, center);
  opacity: 1;
  scale: 1;
  position: relative;
  z-index: 1;
}

/* right 放置：块在 popup 左侧，改为左侧留白 */
.block-handle-positioner.placement-right .block-handle-popup {
  margin-right: 0;
  margin-left: 12px;
}

/* top 放置：块在 popup 下方，仅下方留白（水平居中） */
.block-handle-positioner.placement-top .block-handle-popup {
  margin-right: 0;
  margin-bottom: 12px;
  border-bottom-left-radius: 0px;
  border-bottom-right-radius: 0px;
}

@media (prefers-reduced-motion: reduce) {
  .block-handle-popup {
    transition: none;
  }
}


.block-handle-popup[data-state='closed'] {
  opacity: 0;
  scale: 0.95;
  transition-duration: 0.15s;
}

/* 鼠标在 popup 上时强制保持显示：即使 hoverState 已失效（data-state=closed）
   导致 ProseKit 要隐藏 popup，也保持可见可交互，方便点击 ADD 或拖拽手柄。 */
.block-handle-popup.popup-keep {
  opacity: 1 !important;
  scale: 1 !important;
  display: inline-flex !important;
  visibility: visible !important;
}

@starting-style {
  .block-handle-popup[data-state='open'] {
    opacity: 0;
    scale: 0.95;
  }
}

.block-handle-btn {
  position: relative;
  z-index: 1;
  min-height: 24px;
  min-width: 24px;
  height: 24px;
  width: 24px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 4px;
  color: rgba(var(--v-theme-on-surface), 0.38);
}

/* ProseKit 会给按钮注入一个 44×44 的 ::before 来扩大热区，
   这会让点击位置与显示的按钮不符，且两个按钮的热区互相重叠，
   这里禁用它，让点击区域严格等于按钮本身。 */
.block-handle-btn::before,
.block-handle-btn::after {
  content: none !important;
}

.block-handle-btn:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.1);
}

:root[class*='dark'] .block-handle-btn:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
}

.block-handle-drag {
  z-index: 1;
  cursor: grab;
}

.block-handle-drag:active {
  cursor: grabbing;
}

/* 移动端行高亮（teleport 到 body 的 fixed 元素）：
   整行淡色背景 + 上侧加粗强调，明确标示 popup 所应用的行 */
.block-handle-line-highlight {
  position: fixed;
  left: 0;
  top: 0;
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.07);
  box-shadow: inset 0 2px 0 0 rgba(var(--v-theme-primary), 0.45);
  pointer-events: none;
  z-index: 9999;
}
</style>
