<template>
  <v-sheet class="editor-wrapper">
    <Teleport to="#toolbar-actions" defer>
      <v-btn :loading="isSaving" :icon="mdiContentSave" variant="text" @click="save" />
    </Teleport>
    <Teleport to="#title-actions" defer>
      <v-btn :icon="mdiHome" variant="text" @click="$router.push('/set')" />
    </Teleport>
    <v-container class="toolbar" style="height: 133px;">
      <!-- <v-btn @click="save">保存</v-btn> -->
      <!-- <v-btn @click="load">加载</v-btn> -->
      <!-- 无选中块时进入"添加块"状态，用单选组展示当前类型（滚轮切换、左键直接添加） -->
      <v-btn-toggle
        v-if="!hasSelection && MdrCRef?.isEditMode"
        :model-value="addIdx"
        @update:model-value="onSelectAdd"
        mandatory
      >
        <v-btn v-for="(opt, index) in ADD_OPTIONS" :key="opt.key" :value="index" :data-test="opt.addId">
          <v-icon :icon="opt.icon" class="mr-1" />
          {{ opt.label }}
        </v-btn>
      </v-btn-toggle>
      <v-btn-toggle
        v-if="componentOf == 'RichTextEditor' && MdrCRef?.isEditMode"
        :model-value="opIdx"
        @update:model-value="onSelectOption"
        mandatory
      >
        <v-btn v-for="(opt, index) in OPTIONS" :key="index" :value="index">
          <v-icon :icon="opt.icon"/>
        </v-btn>
      </v-btn-toggle>
      <v-btn @click="toggleEditMode">
        {{ MdrCRef?.isEditMode ? '切换到只读' : '切换到编辑' }}
      </v-btn>
      <v-btn @click="toggleMobileSim">
        {{ mobileButtonLabel }}
      </v-btn>
      <v-btn color="error" data-test="delete-selected" @click="deleteSelected"
        :disabled="!MdrCRef?.isEditMode || MdrCRef?.state.selectedIds.size === 0">
        删除
      </v-btn>
      <v-select
        class="zoom-select"
        :model-value="MdrCRef?.zoom ?? 1"
        :items="ZOOM_OPTIONS"
        label="缩放"
        item-title="title"
        item-value="value"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="MdrCRef?.mobileMode"
        @update:model-value="setZoom"
      />
    </v-container>
    
    <MdrCanvas class="editor-wrapper" ref="MdrCRef"/>

    <!-- 格式操作需确认，所以弹 overlay：左键应用、右键取消（全屏捕获层接管事件） -->
    <v-overlay v-model="pendingApply" persistent scroll-strategy="none">
      <div class="apply-layer" @click.left="confirmApply" @mousedown.right="cancelApply" @contextmenu.prevent="cancelApply">
        <v-card class="apply-card" min-width="240" :class="{ 'place-below': overlayPos.below }"
          :style="{ left: `${overlayPos.left}px`, top: `${overlayPos.top}px` }">
          <v-card-text class="text-center">
            切换「{{ pendingLabel }}」？
          </v-card-text>
          <v-card-actions class="justify-space-between">
            <span class="text-caption text-medium-emphasis ml-3">右键取消</span>
            <v-btn size="small" color="primary" class="mr-1">左键应用</v-btn>
          </v-card-actions>
        </v-card>
      </div>
    </v-overlay>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, inject } from 'vue'
import { mdiFormatHeader1, mdiFormatUnderline, mdiFormatBold, mdiFormatItalic, mdiMouse, mdiNoteText, mdiCodeBraces, mdiContentSave, mdiHome } from '@mdi/js'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { error as logError } from '@tauri-apps/plugin-log'
import MdrCanvas, { type ComponentController } from '../Controls/MdrCanvas.vue'
import { screenToContent } from '../utils/canvasCoords'
import { useRoute } from 'vue-router'
import { invokeCommand } from '../utils/invoke'
import { getErrorMessage } from '../utils/getErrorMessage.ts'
import { takePendingEditorBody } from '../utils/editorRoute'
import { isDebugLoadingEnabled, noteLoadControllerKey } from '../utils/routeTransition'

const noteLoadController = inject(noteLoadControllerKey)

const MdrCRef = ref<InstanceType<typeof MdrCanvas> | null>()

const getComponentRefs = (): Record<string, ComponentController | undefined> =>
  MdrCRef.value!.componentRefs as unknown as Record<string, ComponentController | undefined>

const componentOf = computed(() => {
  const ids = MdrCRef.value?.state.selectedIds ?? new Set<string>()
  if (ids.size !== 1) return false
  const id = Array.from(ids)[0]
  return MdrCRef.value?.state.items.find((it) => it.id === id)?.component
})

// 添加类型单源
const ADD_OPTIONS = [
  { key: 'RichTextEditor', label: '富文本', icon: mdiNoteText, addId: 'add-rich' },
  { key: 'EditableCodeBlock', label: '代码块', icon: mdiCodeBraces, addId: 'add-code' },
] as const
const hasSelection = computed(() => (MdrCRef.value?.state.selectedIds.size ?? 0) > 0)
// 添加类型单选索引
const addIdx = ref(0)
const onSelectAdd = (index: number | null) => {
  if (index == null) return
  addIdx.value = index
}

// 添加预览随当前类型/选中/编辑态同步
watch(
  [addIdx, hasSelection, () => MdrCRef.value?.isEditMode],
  () => {
    const ojc = MdrCRef.value
    if (!ojc) return
    ojc.setAddPreview(hasSelection.value || !ojc.isEditMode ? null : ADD_OPTIONS[addIdx.value]?.key ?? null)
  },
  { immediate: true },
)

// 格式操作单源
const OPTIONS = [
  { icon: mdiMouse, label: '指针', action: () => {} },
  { icon: mdiFormatHeader1, label: '标题', action: () => batchToggleHeading(1) },
  { icon: mdiFormatBold, label: '加粗', action: () => batchToggleBold() },
  { icon: mdiFormatItalic, label: '斜体', action: () => batchToggleItalic() },
  { icon: mdiFormatUnderline, label: '下划线', action: () => batchToggleUnderline() }
] as const

// 单选索引；切换选中块时重置为首项
const opIdx = ref(0)
watch(componentOf, () => { opIdx.value = 0 })

const onSelectOption = (index: number | null) => {
  if (index == null) return
  opIdx.value = index
}

// 仅滚动条轨道上的滚轮滚动内容
const isOnScrollbar = (e: WheelEvent): boolean => {
  const target = e.target as HTMLElement | null
  if (target?.closest?.('.custom-scrollbar')) return true
  for (const el of document.querySelectorAll<HTMLElement>('.editor-scroll')) {
    if (target === el) return true
    const r = el.getBoundingClientRect()
    const verticalWidth = el.offsetWidth - el.clientWidth
    const horizontalHeight = el.offsetHeight - el.clientHeight
    const hasVerticalScroll = el.scrollHeight > el.clientHeight
    const hasHorizontalScroll = el.scrollWidth > el.clientWidth
    const onVerticalTrack = hasVerticalScroll && verticalWidth > 0 &&
      e.clientX >= r.right - verticalWidth && e.clientX <= r.right &&
      e.clientY >= r.top && e.clientY <= r.bottom
    const onHorizontalTrack = hasHorizontalScroll && horizontalHeight > 0 &&
      e.clientY >= r.bottom - horizontalHeight && e.clientY <= r.bottom &&
      e.clientX >= r.left && e.clientX <= r.right
    if (onVerticalTrack || onHorizontalTrack) return true
  }
  return false
}

// 任意位置滚轮按 deltaY 循环切换按钮项：无选中循环添加类型、富文本选中循环格式操作；滚动条上豁免
const cycleOption = (e: WheelEvent) => {
  if (!(e.target as HTMLElement).closest?.('.canvas-container')) return
  if (isOnScrollbar(e)) return
  if (!hasSelection.value) {
    e.preventDefault()
    const len = ADD_OPTIONS.length
    addIdx.value = e.deltaY > 0 ? (addIdx.value + 1) % len : (addIdx.value - 1 + len) % len
    return
  }
  if (componentOf.value !== 'RichTextEditor') return
  e.preventDefault()
  const len = OPTIONS.length
  const next = e.deltaY > 0 ? (opIdx.value + 1) % len : (opIdx.value - 1 + len) % len
  onSelectOption(next)
}

// 要求选区非空且落在当前选中块内
const selectionInBlock = (): boolean => {
  const sel = window.getSelection()
  const id = Array.from(MdrCRef.value!.state.selectedIds)[0]
  const block = document.querySelector(`[data-id="${id}"]`)
  return !!sel && !sel.isCollapsed && !!block &&
    !!sel.anchorNode && !!sel.focusNode && block.contains(sel.anchorNode) && block.contains(sel.focusNode)
}

// selectionchange 途中会误触发，所以改在 mouseup 校验选区，并弹 overlay 询问（左键应用、右键取消）
let applyLockUntil = 0
const pendingApply = ref(false)
const pendingActionIndex = ref(0)
const pendingLabel = computed(() => OPTIONS[pendingActionIndex.value]?.label ?? '更改')
// 记录选区锚点（上方空间不足时改放下方）
const overlayPos = ref({ left: 0, top: 0, below: false })

// 把视口鼠标坐标换算为画布 content 坐标
const canvasPointFromMouse = (e: MouseEvent): { x: number; y: number } | null => {
  const cont = document.querySelector<HTMLElement>('.canvas-container')
  const ojc = MdrCRef.value
  if (!cont || !ojc) return null
  return screenToContent(
    { zoom: ojc.zoom, origin: ojc.origin, pan: ojc.pan },
    cont.getBoundingClientRect(),
    e.clientX,
    e.clientY,
  )
}

// 记录按下位置以区分简单点击与拖动框选
const CLICK_DRAG_THRESHOLD = 4
let mouseDownX = 0
let mouseDownY = 0
// 已有选中时本次点击语义为取消选中，添加逻辑须跳过
let isDeselectClick = false
// 点击已有块时选中集可能为空，所以记录按下是否落在块/浮层内，落在其上走选中而非添加
let isBlockPress = false
const trackMouseDown = (e: MouseEvent) => {
  mouseDownX = e.clientX
  mouseDownY = e.clientY
  isDeselectClick = hasSelection.value
  isBlockPress = !!(e.target as HTMLElement).closest?.('.drag-wrapper, .floating-handle, .side-settings, .handle, .block-handle-popup')
}

const onMouseUp = (e: MouseEvent) => {
  if (pendingApply.value) return
  // 无选中块：处于"添加块"状态，画布内左键在鼠标位置直接添加当前滚轮选中的类型（工具栏点击/只读态不触发）
  if (!hasSelection.value) {
    // 取消多选的点击已在 mouseup 前清空选中，所以此处拦截避免误入添加分支
    if (isDeselectClick || isBlockPress) return
    if (!MdrCRef.value?.isEditMode || e.button !== 0) return
    if (!(e.target as HTMLElement).closest('.canvas-container')) return
    // 仅位移小于阈值的简单点击才添加
    if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) > CLICK_DRAG_THRESHOLD) return
    const key = ADD_OPTIONS[addIdx.value]?.key
    if (key) MdrCRef.value?.addComponent(key, canvasPointFromMouse(e) ?? undefined)
    return
  }
  if (componentOf.value !== 'RichTextEditor' || Date.now() < applyLockUntil || !selectionInBlock()) return
  if (opIdx.value === 0) return
  applyLockUntil = Date.now() + 300
  pendingActionIndex.value = opIdx.value
  // 以选区矩形为锚点并夹紧到视口内：垂直优先放上方，上方不足放下方
  const rangeRect = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
  if (rangeRect && rangeRect.width > 0) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const CARD_W = 240
    const CARD_H = 110
    const M = 8
    const left = Math.min(Math.max(rangeRect.left + rangeRect.width / 2, CARD_W / 2 + M), vw - CARD_W / 2 - M)
    const aboveSpace = rangeRect.top - M
    const belowSpace = vh - rangeRect.bottom - M
    let top: number
    let below: boolean
    if (aboveSpace >= CARD_H) {
      top = rangeRect.top
      below = false
    } else if (belowSpace >= CARD_H) {
      top = rangeRect.bottom
      below = true
    } else if (aboveSpace >= belowSpace) {
      top = Math.max(rangeRect.top, M)
      below = false
    } else {
      top = Math.min(rangeRect.bottom, vh - M)
      below = true
    }
    overlayPos.value = { left, top, below }
  }
  pendingApply.value = true
}

const confirmApply = () => {
  pendingApply.value = false
  OPTIONS[pendingActionIndex.value]?.action()
  // 选区保留会经 mouseup 再次询问，所以应用后同样清除选区并失焦
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  window.getSelection()?.removeAllRanges()
}

const cancelApply = () => {
  pendingApply.value = false
  // ProseMirror 失焦前会恢复内部选区，所以须先 blur 再清选区，否则右键 mouseup 会重开询问
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  window.getSelection()?.removeAllRanges()
}

const mobileButtonLabel = computed(() => {
  if (MdrCRef.value?.forceMobile === null) return '模拟移动端'
  return MdrCRef.value?.forceMobile ? '强制桌面' : '恢复自动布局'
})

const toggleMobileSim = () => {
  // 模式切换会重挂载组件，先同步组件数据
  MdrCRef.value!.syncComponentData()
  // 布局刷新由 watch(mobileMode) 统一处理，此处仅切换标志
  MdrCRef.value!.forceMobile = MdrCRef.value!.nextForceMobile()
}

const toggleEditMode = () => {
  MdrCRef.value!.isEditMode = !MdrCRef.value!.isEditMode
}

const ZOOM_OPTIONS = [
  { title: '50%', value: 0.5 },
  { title: '100%', value: 1 },
  { title: '200%', value: 2 },
  { title: '300%', value: 3 },
] as const

// 中转一次，避免模板里写嵌套 ref 赋值
const setZoom = (v: number | null) => {
  if (typeof v !== 'number' || v <= 0) return
  MdrCRef.value!.zoom = v
}

const route = useRoute()
// route.params 可能是数组，所以统一取首项
const fileName = Array.isArray(route.params.fileName) ? route.params.fileName[0] : route.params.fileName
const pendingEditorBody = takePendingEditorBody(String(fileName ?? ''))

const isSaving = ref(false)
const save = async () => {
  isSaving.value = true
  try {
    await invokeCommand("set_mdr_file_body", { fileName, content: MdrCRef.value?.save() ?? '' })
  } catch (error) {
    logError(getErrorMessage(error))
  }
  finally {
    isSaving.value = false
  }
}

const load = async () => {
  const raw = pendingEditorBody
    ? await pendingEditorBody
    : await invokeCommand<{ content: string }>("get_mdr_file_body", {
        fileName,
        debugProgress: isDebugLoadingEnabled.value,
      })
  if ('error' in raw) throw raw.error
  await MdrCRef.value?.load(raw.content ?? '')
}

const batchToggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  const refs = getComponentRefs()
  Array.from(MdrCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleHeading?.({ level })
  })
}

const batchToggleBold = () => {
  const refs = getComponentRefs()
  Array.from(MdrCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleBold?.()
  })
}

const batchToggleItalic = () => {
  const refs = getComponentRefs()
  Array.from(MdrCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleItalic?.()
  })
}

const batchToggleUnderline = () => {
  const refs = getComponentRefs()
  Array.from(MdrCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleUnderline?.()
  })
}

const deleteSelected = () => {
  if (!MdrCRef.value?.isEditMode || MdrCRef.value.state.selectedIds.size === 0) return
  const ids = Array.from(MdrCRef.value!.state.selectedIds)
  MdrCRef.value!.state.items = MdrCRef.value!.state.items.filter((it) => !ids.includes(it.id))
  MdrCRef.value!.state.selectedIds = new Set()
  const refs = getComponentRefs()
  ids.forEach(id => { delete refs[id] })
}

const initializeEditor = async () => {
  let unlisten: (() => void) | undefined
  noteLoadController?.setName(String(fileName ?? ''))
  try {
    if (isTauri() && !pendingEditorBody) {
      unlisten = await listen<number>('file-load-progress', (event) => {
        noteLoadController?.setProgress(event.payload)
      })
    }
    noteLoadController?.setProgress(2)
    await load()
    noteLoadController?.setProgress(100)
  } catch (error) {
    if (isTauri()) logError(getErrorMessage(error))
  } finally {
    unlisten?.()
    noteLoadController?.finish()
  }
}

onMounted(() => {
  void initializeEditor()
  // 挂 window 级并显式非 passive（否则 preventDefault 无效）
  window.addEventListener('wheel', cycleOption, { passive: false })
  // 选字可能跨出编辑器，所以挂 window 级 mouseup
  window.addEventListener('mouseup', onMouseUp)
  // 挂 window 级 mousedown 记录按下位置
  window.addEventListener('mousedown', trackMouseDown)
})

onUnmounted(() => {
  window.removeEventListener('wheel', cycleOption)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousedown', trackMouseDown)
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
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}

.zoom-select {
  width: 110px;
  margin: 0 8px;
}

/* 未选中按钮背景与工具栏同色、看不出边界，所以补半透明底色 */
.v-btn-toggle :deep(.v-btn:not(.v-btn--selected)) {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

/* v-overlay__content 尺寸为 0（inset 失效），所以用 vw/vh 显式铺满并置 z 高于 scrim */
.apply-layer {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1;
}
/* 绝对定位 + translate 使卡片居中于选区上方；空间不足时由 place-below 改放下方 */
.apply-card {
  position: absolute;
  transform: translate(-50%, calc(-100% - 8px));
}
.apply-card.place-below {
  transform: translate(-50%, 8px);
}
</style>