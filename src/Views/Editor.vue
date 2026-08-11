<template>
  <v-sheet class="editor-wrapper">
    <div class="toolbar">
      <v-btn @click="save">保存</v-btn>
      <v-btn @click="load">加载</v-btn>
      <v-btn v-for="comp in OJCRef?.ADDABLE_COMPONENTS" :key="comp.key" :data-test="comp.addId" @click="OJCRef?.addComponent(comp.key)">
        ➕ 添加{{ comp.label }}
      </v-btn>
      <v-btn @click="batchToggleHeading(2)">选中设为二级标题</v-btn>
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
    </div>
    
    <OJCanvas class="editor-wrapper" ref="OJCRef"/>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

import OJCanvas, { type ComponentController } from '../Controls/OJCanvas.vue'

const OJCRef = ref<InstanceType<typeof OJCanvas> | null>()

const getComponentRefs = (): Record<string, ComponentController | undefined> =>
  OJCRef.value!.componentRefs as unknown as Record<string, ComponentController | undefined>

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
    refs[id]?.commands?.toggleHeading?.(level)
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
})

onUnmounted(() => {
  
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
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
}

.zoom-slider {
  margin: 0 8px;
}
</style>