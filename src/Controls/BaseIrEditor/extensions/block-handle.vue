<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import { mdiPlus, mdiDragVerticalVariant } from '@mdi/js'
import {
  BlockHandleAdd,
  BlockHandleDraggable,
  BlockHandlePopup,
  BlockHandlePositioner,
  BlockHandleRoot,
} from 'prosekit/vue/block-handle'
import type { Editor } from '@prosekit/core'
import { createStoreResolver, getScrollEl, getView } from './blockHandleUtils'
import { useHoverState } from './useHoverState'
import { useHoverUi } from './useHoverUi'
import { useBlockDrag } from './useBlockDrag'
import { activeHandleBlockId } from './blockHandleOwner'

interface Props {
  dir?: 'ltr' | 'rtl'
  editor?: Editor | null
}
const props = defineProps<Props>()

// ProseKit BlockHandleStore 每编辑器独立且各 composable 需共享，按实例闭包缓存解析
const getStore = createStoreResolver()

const { hoveredBlock, activeHover, handlePlacement, onBlockStateChange } = useHoverState(
  props.editor ?? null,
  props.dir ?? 'ltr',
  getStore,
)
const {
  highlightRect,
  highlightStyle,
  popupShiftPx,
  popupHShiftPx,
  popupKeep,
  handleVisible,
  onPopupEnter,
  onPopupLeave,
  suppressUI,
} = useHoverUi({
  editor: props.editor ?? null,
  hoveredBlock,
  activeHover,
  placement: handlePlacement,
})
const { isDragging, onDragPointerDown } = useBlockDrag({
  editor: props.editor ?? null,
  hoveredBlock,
  suppressUI,
})

// popup 已 Teleport 到 .canvas（脱离 wrapper DOM），画布需经 data-block-id 反查所属块，
// 从 wrapper 取块 id 绑定到 popup（watcher 内亦用同款取法）
const blockId = computed(() => {
  const wrapper = getView(props.editor)?.dom?.closest('.drag-wrapper') as HTMLElement | null
  return wrapper?.dataset.id ?? null
})

// blockId computed 依赖 props.editor 引用不变时不重算、挂载时序可能取到 null，
// 协调逻辑用函数实时查 DOM，避免 id 过期为 null 导致误隐藏自己
const currentBlockId = () => getView(props.editor)?.dom?.closest('.drag-wrapper')?.dataset.id ?? null

// 模块级 ref 是响应式的，任一实例把 owner 改成别的块时其余实例立即收到更新并强制收起自己，
// 保证同一时刻只显示离鼠标最近（最后激活）的块
watch(activeHandleBlockId, (ownerId) => {
  if (!ownerId) return
  const id = currentBlockId()
  if (id && ownerId !== id) suppressUI()
})

// 自己显隐变化时注册/注销 owner（仅在确实显示时占有，避免隐藏残留块仍占 owner）
watch(handleVisible, (visible) => {
  const id = currentBlockId()
  if (visible && id) {
    activeHandleBlockId.value = id
  } else if (!visible && activeHandleBlockId.value === id) {
    activeHandleBlockId.value = null
  }
})

// 组件卸载时释放 owner，避免残留块 id 阻塞其他块显示
onUnmounted(() => {
  if (activeHandleBlockId.value === currentBlockId()) {
    activeHandleBlockId.value = null
  }
})

// 行高亮 popup（top 放置）只有真正盖住块顶部正中间缩放手柄（.handle-tm）时才需隐藏该 tm，
// 在 hover 位置/显隐/放置方向变化后经双 rAF 量取 popup 与 tm 实际矩形判断遮挡再派发，
// 避免 popup 移到非首行（不盖住 tm）时 tm 仍被隐藏
function popupOverlapsTm(): boolean {
  const dom = getView(props.editor)?.dom as HTMLElement | null
  const wrapper = dom?.closest('.drag-wrapper') as HTMLElement | null
  if (!wrapper) return false
  // popup 已 Teleport 到 .canvas（脱离 wrapper），此处全局查找
  const popup = document.querySelector<HTMLElement>('.block-handle-popup')
  const tm = wrapper.querySelector<HTMLElement>('.handle-tm')
  if (!popup || !tm) return false
  const pr = popup.getBoundingClientRect()
  const tr = tm.getBoundingClientRect()
  if (pr.width <= 0 || pr.height <= 0 || tr.width <= 0 || tr.height <= 0) return false
  return pr.left < tr.right && pr.right > tr.left && pr.top < tr.bottom && pr.bottom > tr.top
}

let tmSyncRaf = 0
function syncTmOverlap() {
  cancelAnimationFrame(tmSyncRaf)
  // popup 位置由 floating-ui 异步更新，双 rAF 确保量到的是最新位置
  tmSyncRaf = requestAnimationFrame(() => {
    tmSyncRaf = requestAnimationFrame(() => {
      const wrapper = getView(props.editor)?.dom?.closest('.drag-wrapper') as HTMLElement | null
      const blockId = wrapper?.dataset.id ?? null
      const open = !!handleVisible.value && popupOverlapsTm()
      window.dispatchEvent(new CustomEvent('omnijot:block-popup', { detail: { open, blockId } }))
    })
  })
}

// tm 遮挡需随 hover 位置（activeHover 变化）、显隐（handleVisible）、
// 放置方向（handlePlacement）与 keepAlive（popupKeep）一起重算，监听以上全部
watch([handleVisible, activeHover, popupKeep, handlePlacement], syncTmOverlap)

// 富文本 popup 上侧开启时会盖住画布连接点处的曲别针（交互冲突），
// 派发事件通知画布隐藏曲别针（代码块无 block-handle，仅富文本走此路径）
watch([handleVisible, handlePlacement], () => {
  const topOpen = !!handleVisible.value && handlePlacement.value === 'top'
  window.dispatchEvent(new CustomEvent('omnijot:block-popup-top', { detail: { open: topOpen } }))
})

// popup 弹出时鼠标移向 popup 会经过上方的组件，若画布 hover 聚焦把焦点切到背后块 popup 即消失，
// 派发事件通知画布"该块 popup 激活"，让 hover 聚焦暂停直至 popup 关闭
watch(handleVisible, (visible) => {
  const wrapper = getView(props.editor)?.dom?.closest('.drag-wrapper') as HTMLElement | null
  const blockId = wrapper?.dataset.id ?? null
  window.dispatchEvent(new CustomEvent('omnijot:block-handle-active', { detail: { active: !!visible, blockId } }))
})

// popup 贴右缘时可能盖住滚动条，此时 wheel 目标落在 popup 上（其祖先无滚动容器），
// 鼠标位于滚动条矩形内时手动转发 delta 并 stopPropagation 防止被切项逻辑拦截
const onPopupWheel = (e: WheelEvent) => {
  const scrollEl = getScrollEl(getView(props.editor))
  if (!scrollEl) return
  const r = scrollEl.getBoundingClientRect()
  const vBarW = scrollEl.offsetWidth - scrollEl.clientWidth
  const hBarH = scrollEl.offsetHeight - scrollEl.clientHeight
  const x = e.clientX
  const y = e.clientY
  const onVBar = vBarW > 0 && x >= r.right - vBarW && x <= r.right && y >= r.top && y <= r.bottom
  const onHBar = hBarH > 0 && y >= r.bottom - hBarH && y <= r.bottom && x >= r.left && x <= r.right
  if (!onVBar && !onHBar) return
  if (onVBar) scrollEl.scrollTop += e.deltaY
  if (onHBar) scrollEl.scrollLeft += e.deltaX
  e.stopPropagation()
}
</script>

<template>
  <!-- popup 需显示在曲别针（1003）之上，而其在编辑器内受块层叠上下文限制（对外层级=块 z），
       把含 provider 的 Root 整体 Teleport 到 .canvas：store context 不丢、
       floating-ui 初始化即以 .canvas 为 containing block 计算定位（初始即正确，无需移动重算） -->
  <Teleport to=".canvas">
    <BlockHandleRoot @state-change="onBlockStateChange">
      <BlockHandlePositioner
        :placement="handlePlacement"
        :hide="false"
        :class="['block-handle-positioner', `placement-${handlePlacement}`]"
        :style="{ '--block-handle-shift': popupShiftPx + 'px', '--block-handle-hshift': popupHShiftPx + 'px' }"
      >
      <BlockHandlePopup
        class="block-handle-popup"
        :data-block-id="blockId"
        :class="{ 'popup-keep': popupKeep, 'forced-open': handleVisible, 'ui-hidden': !handleVisible }"
        @pointerenter="onPopupEnter"
        @pointerleave="onPopupLeave"
        @wheel="onPopupWheel"
      >
        <BlockHandleAdd class="block-handle-btn">
          <v-icon :icon="mdiPlus" size="20" />
        </BlockHandleAdd>
        <BlockHandleDraggable
          class="block-handle-btn block-handle-drag"
          @pointerdown.prevent="onDragPointerDown"
        >
          <v-icon :icon="mdiDragVerticalVariant" size="20" />
        </BlockHandleDraggable>
      </BlockHandlePopup>
      </BlockHandlePositioner>
    </BlockHandleRoot>
  </Teleport>

  <!-- .vdr 的 transform/overflow 会裁剪 fixed 高亮，teleport 到 body；按 placement 加类供 CSS 翻转强调小条方向 -->
  <Teleport to="body">
    <div v-if="highlightRect && !isDragging" class="block-handle-line-highlight" :class="`placement-${handlePlacement}`" :style="highlightStyle" />
  </Teleport>
</template>

<style scoped>
.block-handle-positioner {
  display: block;
  overflow: visible;
  width: min-content;
  height: min-content;
  /* popup 需显示在曲别针之上，置 Z_LAYER.popup（1005，.canvas 内最高层，随画布缩放）；
     z-index 仅对定位元素生效，显式 absolute，避免 floating-ui 未注入定位时 popup 被上方组件盖住 */
  position: absolute;
  z-index: 1005;
  transition: transform 0.1s ease-out;
  pointer-events: none;
  inset: auto;
  margin-left: 8px; /* floating-ui 默认 -8px 会左移，以 8px 抵消让 popup 与块左对齐 */
}

/* right/top 时 floating-ui 的 translate 为正值或垂直方向，不需抵消 -8px */
.block-handle-positioner.placement-right {
  margin-right: 8px;
}
.block-handle-positioner.placement-top {
  margin-left: 0;
  margin-top: 16px;
}

/* floating-ui 在 bottom 时下移 6px，以负 margin-top 抵消让 popup 顶边紧贴行底（与 top 放置对称） */
.block-handle-positioner.placement-bottom {
  margin-left: 0;
  margin-top: -4px;
}

@media (prefers-reduced-motion: reduce) {
  .block-handle-positioner {
    transition: none;
  }
}

.block-handle-popup {
  background-color: color-mix(in srgb, rgb(var(--v-theme-surface)) 90%, rgb(var(--v-theme-on-surface)) 10%);
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

/* popup 与行/块之间有间距空隙，鼠标经过空隙时块与 popup 的 pointerleave 先后触发、
   未及进入 popup 就会先执行 100ms 失效清理让 popup 消失，用伪元素向块方向扩展透明桥接区
   （继承 popup 的 pointer-events:auto），使鼠标在空隙时即触发 popup 的 pointerenter 保持显示 */
.block-handle-popup::before {
  content: '';
  position: absolute;
  pointer-events: auto;
}
.block-handle-positioner.placement-top .block-handle-popup::before {
  left: 0;
  right: 0;
  top: 100%;
  height: 24px;
}
.block-handle-positioner.placement-bottom .block-handle-popup::before {
  left: 0;
  right: 0;
  bottom: 100%;
  height: 24px;
}
.block-handle-positioner.placement-right .block-handle-popup::before {
  top: 0;
  bottom: 0;
  right: 100%;
  width: 24px;
}
.block-handle-positioner.placement-left .block-handle-popup::before {
  top: 0;
  bottom: 0;
  left: 100%;
  width: 24px;
}

/* 滚动条出现使文本右缘左移、右侧 popup 会偏移不对称，按滚动条宽度（--block-handle-hshift）向右推回贴齐块外边缘 */
.block-handle-positioner.placement-right .block-handle-popup {
  margin-right: 0;
  margin-left: -6px;
  transform: translateX(var(--block-handle-hshift, 0px));
}

.block-handle-positioner.placement-top .block-handle-popup {
  margin-right: 0;
  margin-bottom: 12px;
  border-bottom-left-radius: 0px;
  border-bottom-right-radius: 0px;
}

.block-handle-positioner.placement-bottom .block-handle-popup {
  margin-right: 0;
  border-top-left-radius: 0px;
  border-top-right-radius: 0px;
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

/* hoverState 失效时 ProseKit 会隐藏 popup，为使鼠标在手柄上仍可点击 ADD/拖拽，强制保持显示 */
.block-handle-popup.popup-keep {
  opacity: 1 !important;
  scale: 1 !important;
  display: inline-flex !important;
  visibility: visible !important;
}

/* 行部分在画布容器外时 ProseKit overlay 判定 anchor 不可见而置 data-state=closed（popup 隐藏），
   但 hover 已命中（行高亮显示），activeHover 时强制显示，位置由 popupShiftPx 贴回可见区 */
.block-handle-popup.forced-open {
  opacity: 1 !important;
  scale: 1 !important;
  display: inline-flex !important;
  visibility: visible !important;
}

/* 编辑器失焦/鼠标移出编辑器时需与行高亮同步立即隐藏（覆盖 popup-keep/forced-open 的强制显示），
   用 visibility/opacity 隐藏而不用 display:none——后者会让 popup 尺寸变 0、
   floating-ui 在 0 与真实尺寸间跳变，positioner 的 transform 过渡就会"到处乱飞" */
.block-handle-popup.ui-hidden {
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
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

/* ProseKit 会注入 44×44 的 ::before 扩大热区、导致点击位置与显示不符，禁用它让点击区域等于按钮本身 */
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

/* placement-bottom 时强调小条需翻转到高亮下缘，与上方对称 */
.block-handle-line-highlight.placement-bottom {
  box-shadow: inset 0 -2px 0 0 rgba(var(--v-theme-primary), 0.45);
}

/* 拖拽期间需跨编辑器隐藏所有 popup 与行高亮，由 body 上的拖拽类全局控制 */
body.block-handle-dragging .block-handle-popup {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
body.block-handle-dragging .block-handle-line-highlight {
  display: none !important;
}
</style>
