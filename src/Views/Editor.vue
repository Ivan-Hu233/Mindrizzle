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
    </div>
    
    <OJCanvas class="editor-wrapper" ref="OJCRef"/>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

import OJCanvas, { type ComponentController } from '../Controls/OJCanvas.vue'

const OJCRef = ref<InstanceType<typeof OJCanvas> | null>()

const getComponentRefs = (): Record<string, ComponentController | undefined> =>
  OJCRef.value!.componentRefs.value as unknown as Record<string, ComponentController | undefined>

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
</style>