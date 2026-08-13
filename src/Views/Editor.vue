<template>
  <v-sheet class="editor-wrapper">
    <v-sheet class="toolbar" color="surface">
      <v-btn @click="save">保存</v-btn>
      <v-btn @click="load">加载</v-btn>
      <v-btn v-for="comp in OJCRef?.ADDABLE_COMPONENTS" :key="comp.key" :data-test="comp.addId" @click="OJCRef?.addComponent(comp.key)">
        ➕ 添加{{ comp.label }}
      </v-btn>
      <v-btn-toggle
        
        :model-value="opIdx"
        @update:model-value="onSelectOption"
        mandatory
      >
        <v-btn v-for="(opt, index) in OPTIONS" :key="index" :value="index">
          <v-icon :icon="opt.icon"/>
        </v-btn>
      </v-btn-toggle>
      <v-btn @click="toggleEditMode">
        {{ OJCRef?.isEditMode ? '切换到只读' : '切换到编辑' }}
      </v-btn>
      <v-btn @click="toggleMobileSim">
        {{ mobileButtonLabel }}
      </v-btn>
      <v-btn color="error" data-test="delete-selected" @click="deleteSelected" :disabled="OJCRef?.state.selectedIds.size === 0">
        删除
      </v-btn>
      <!-- 等比例缩放画布：仅视觉 scale，交互坐标按 /zoom 换算 -->
      <v-slider
        class="zoom-slider"
        :model-value="OJCRef?.zoom ?? 1"
        :label="`缩放 ${Math.round((OJCRef?.zoom ?? 1) * 100)}%`"
        min="0.5" max="3" step="0.5" hide-details
        :disabled="OJCRef?.mobileMode"
        @update:model-value="setZoom"
      />
    </v-sheet>
    
    <OJCanvas class="editor-wrapper" ref="OJCRef"/>

    <!-- 因格式操作需用户确认而非直接应用，故弹 overlay 询问：
         任意位置左键应用、右键取消并清选区（用全屏捕获层接管事件，避开 v-overlay 根透传限制） -->
    <v-overlay v-model="pendingApply" persistent scroll-strategy="none">
      <div class="apply-layer" @click.left="confirmApply" @mousedown.right="cancelApply" @contextmenu.prevent="cancelApply">
        <v-card class="apply-card" min-width="240" :class="{ 'place-below': overlayPos.below }"
          :style="{ left: `${overlayPos.left}px`, top: `${overlayPos.top}px` }">
          <v-card-text class="text-center">
            应用「{{ pendingLabel }}」？
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
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { mdiFormatHeader1, mdiFormatUnderline , mdiFormatBold, mdiFormatItalic, mdiMouse } from '@mdi/js'
import OJCanvas, { type ComponentController } from '../Controls/OJCanvas.vue'

const OJCRef = ref<InstanceType<typeof OJCanvas> | null>()

const getComponentRefs = (): Record<string, ComponentController | undefined> =>
  OJCRef.value!.componentRefs as unknown as Record<string, ComponentController | undefined>

// 因标题命令仅富文本块支持且批量操作语义不清晰，故工具栏仅"单选富文本块"时显示
const componentOf = computed(() => {
  const ids = OJCRef.value?.state.selectedIds ?? new Set<string>()
  if (ids.size !== 1) return false
  const id = Array.from(ids)[0]
  return OJCRef.value?.state.items.find((it) => it.id === id)?.component
})

// 因按钮项各自携带图标与操作且轮换按索引推进，故集中为单一常量源
const OPTIONS = [
  { icon: mdiMouse, label: '指针', action: () => {} },
  { icon: mdiFormatHeader1, label: '标题', action: () => batchToggleHeading(1) },
  { icon: mdiFormatBold, label: '加粗', action: () => batchToggleBold() },
  { icon: mdiFormatItalic, label: '斜体', action: () => batchToggleItalic() },
  { icon: mdiFormatUnderline, label: '下划线', action: () => batchToggleUnderline() }
] as const

// 因按钮组需单选高亮且默认选中首项，故记录当前索引；切换选中块时重置为首项
const opIdx = ref(0)
watch(componentOf, () => { opIdx.value = 0 })

// 因操作已由各按钮项的 action 字段声明，故此处仅按索引分发对应操作
const onSelectOption = (index: number | null) => {
  if (index == null) return
  opIdx.value = index
}

// 因需整个界面任意位置滚轮循环切换按钮项，故按 deltaY 方向在索引间循环；
// 因仅选中富文本块时才有按钮组，故此时才拦截滚轮；
// 因编辑器/文本框内滚轮需滚动内容，故豁免，避免循环切项挡住阅读
const cycleOption = (e: WheelEvent) => {
  if (componentOf.value !== 'RichTextEditor') return
  e.preventDefault()
  const len = OPTIONS.length
  const next = e.deltaY > 0 ? (opIdx.value + 1) % len : (opIdx.value - 1 + len) % len
  onSelectOption(next)
}

// 因仅富文本块内选中文本时应自动应用当前按钮项操作，故要求选区非空且落在当前选中块内
const selectionInBlock = (): boolean => {
  const sel = window.getSelection()
  const id = Array.from(OJCRef.value!.state.selectedIds)[0]
  const block = document.querySelector(`[data-id="${id}"]`)
  return !!sel && !sel.isCollapsed && !!block &&
    !!sel.anchorNode && !!sel.focusNode && block.contains(sel.anchorNode) && block.contains(sel.focusNode)
}

// 因仅 mouseup 时选区才算定稿（拖动选字中途 selectionchange 高频误触发、暂停即会提前应用），
// 故不监听 selectionchange，改在 mouseup 时校验选区；操作不直接执行，
// 而是弹 overlay 询问用户：左键应用、右键取消并清选区
let applyLockUntil = 0
const pendingApply = ref(false)
const pendingActionIndex = ref(0)
const pendingLabel = computed(() => OPTIONS[pendingActionIndex.value]?.label ?? '更改')
// 因 v-card 需显示在选区附近，故记录选区矩形的中心 x 与上缘 y（上方空间不足时改放下方）
const overlayPos = ref({ left: 0, top: 0, below: false })

const onMouseUp = () => {
  if (pendingApply.value) return // 询问中不重复触发
  if (componentOf.value !== 'RichTextEditor' || Date.now() < applyLockUntil || !selectionInBlock()) return
  if (opIdx.value === 0) return // 指针模式无可应用操作
  applyLockUntil = Date.now() + 300
  pendingActionIndex.value = opIdx.value
  // 因卡片需贴近选区显示，故以选区矩形为锚点并夹紧到视口内（防超出屏幕）：
  // 水平中心限在卡片半宽+间距内；垂直优先放选区上方，上方不足放下方，均不足选空间大一侧
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
  // 因应用后选区仍保留会经 mouseup 再次询问，故同取消一样清除选区并失焦
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  window.getSelection()?.removeAllRanges()
}

const cancelApply = () => {
  pendingApply.value = false
  // 因 ProseMirror 失焦前会保持并恢复内部选区，仅 removeAllRanges 后右键的 mouseup
  // 仍会经 onMouseUp 重开询问，故让编辑器失焦使 DOM 选区保持为空
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  window.getSelection()?.removeAllRanges()
}

const mobileButtonLabel = computed(() => {
  if (OJCRef.value?.forceMobile === null) return '模拟移动端'
  return OJCRef.value?.forceMobile ? '强制桌面' : '恢复自动布局'
})

const toggleMobileSim = () => {
  OJCRef.value!.syncComponentData() // 因模式切换会重挂载组件，故先同步组件数据
  OJCRef.value!.forceMobile = OJCRef.value!.nextForceMobile() // 因布局刷新由 watch(mobileMode) 统一处理，故此处仅切换标志
}

const toggleEditMode = () => {
  OJCRef.value!.isEditMode = !OJCRef.value!.isEditMode
}

// 因非友好缩放比（整数/半整数之外）会让内容乘缩放比落亚像素、即便取整也抖动模糊，
// 故滑块吸附到友好缩放比（0.5 步进），保证视觉像素整数化稳定清晰
const SHARP_SCALES = [0.5, 1, 1.5, 2, 2.5, 3]
const getSharpScale = (target: number) =>
  SHARP_SCALES.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))

// 因滑动条直接改内部 ref，故中转一次避免模板里写嵌套 ref 赋值；同时吸附到友好缩放比
const setZoom = (v: number | null) => {
  const t = typeof v === 'number' && v > 0 ? v : 1
  OJCRef.value!.zoom = getSharpScale(t)
}

const save = () => {
  localStorage.setItem('canvasData', OJCRef.value?.save() ?? '')
}

const load = async () => {
  const raw = localStorage.getItem('canvasData')
  OJCRef.value?.load(raw ?? '')
}

const batchToggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  const refs = getComponentRefs()
  Array.from(OJCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleHeading?.({ level })
  })
}

const batchToggleBold = () => {
  const refs = getComponentRefs()
  Array.from(OJCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleBold?.()
  })
}

const batchToggleItalic = () => {
  const refs = getComponentRefs()
  Array.from(OJCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleItalic?.()
  })
}

const batchToggleUnderline = () => {
  const refs = getComponentRefs()
  Array.from(OJCRef.value!.state.selectedIds).forEach((id) => {
    refs[id]?.commands?.toggleUnderline?.()
  })
}

const deleteSelected = () => {
  if (OJCRef.value!.state.selectedIds.size === 0) return
  const ids = Array.from(OJCRef.value!.state.selectedIds)
  OJCRef.value!.state.items = OJCRef.value!.state.items.filter((it) => !ids.includes(it.id))
  OJCRef.value!.state.selectedIds = new Set()
  const refs = getComponentRefs()
  ids.forEach(id => { delete refs[id] })
}

onMounted(() => {
  load()
  // 因需整个界面任意位置滚轮切换按钮项且需阻止默认滚动，故挂 window 级监听并显式非 passive（否则 preventDefault 无效）
  window.addEventListener('wheel', cycleOption, { passive: false })
  // 因拖动选字可能跨出编辑器范围，mouseup 会落在编辑器外，故挂 window 级 mouseup 确保松开时都能定稿应用
  window.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('wheel', cycleOption)
  window.removeEventListener('mouseup', onMouseUp)
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

.zoom-slider {
  margin: 0 8px;
}

/* 因需 overlay 任意位置响应左键/右键，故用全屏捕获层接管；
   因 v-overlay__content 容器尺寸为 0（inset 失效），故用 vw/vh 显式铺满并置 z 高于 scrim */
.apply-layer {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1;
}
/* 因 v-card 需显示在选区上方且水平居中于选区中心，故绝对定位 + translate 上移整卡；空间不足时由 place-below 改放选区下方 */
.apply-card {
  position: absolute;
  transform: translate(-50%, calc(-100% - 8px));
}
.apply-card.place-below {
  transform: translate(-50%, 8px);
}
</style>