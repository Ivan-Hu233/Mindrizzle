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
  { icon: mdiMouse, action: () => {} },
  { icon: mdiFormatHeader1, action: () => batchToggleHeading(1) },
  { icon: mdiFormatBold, action: () => batchToggleBold() },
  { icon: mdiFormatItalic, action: () => batchToggleItalic() },
  { icon: mdiFormatUnderline, action: () => batchToggleUnderline() }
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
// 故不监听 selectionchange，改在 mouseup 时校验选区并应用当前按钮项操作；
// 操作会改动选区但不会触发 mouseup，故仅保留冷却屏蔽连点
let applyLockUntil = 0
const onMouseUp = () => {
  if (componentOf.value !== 'RichTextEditor' || Date.now() < applyLockUntil || !selectionInBlock()) return
  applyLockUntil = Date.now() + 300
  OPTIONS[opIdx.value]?.action()
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
</style>