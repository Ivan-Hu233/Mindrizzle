<script setup lang="ts">
import { shallowRef, watch } from 'vue'

const props = defineProps(['isOpen'])
const emit = defineEmits(['update:close'])
let dialog = shallowRef(false)
watch(() => props.isOpen, (newValue) => {
  dialog.value = (newValue as boolean)
})
watch(() => dialog.value,(newValue) => {
  dialog.value = newValue
  emit("update:close",newValue)
})

const short_invalid_empty_rules = [
  (value: any) => {
    if (value) return true
    return '不可为空'
  },
  (value: string) => {
    if (value.length <= 30) return true
    return '太长了'
  }
]
const file_invalid_empty_rules = [
  (value: any) => {
    if (value) return true
    return '不可为空'
  },
  (value: string) => {
    if (isValidFileName(value)) return true
    return '文件名必须非空、长度≤50、不含 \ / : * ? " < > |，不以空格开头或空格/点结尾，且不能是 Windows 保留设备名（如 CON、NUL 等，不区分大小写）。'
  }
]
const long_invalid_empty_rules = [
  (value: any) => {
    if (value) return true
    return '不可为空'
  },
  (value: string) => {
    if (value.length <= 200) return true
    return '太长了'
  }
]

function isValidFileName(name: string): boolean {
  if (!name || name.length > 50) return false;
  if (/[\\/:*?"<>|]/.test(name)) return false;        // 非法字符
  if (/^\s|[\s.]$/.test(name)) return false;          // 开头空格 或 结尾空格/点
  const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  if (reserved.includes(name.toUpperCase())) return false;
  return true;
}
</script>
<template>
  <v-dialog v-model="dialog" max-width="500">
    <v-card>
      <v-card-text>
        <v-form>
          <v-text-field :counter="30" :rules="short_invalid_empty_rules" label="标题" />
          <v-text-field :counter="200" :rules="long_invalid_empty_rules" label="描述" />
          <v-text-field :counter="30" :rules="file_invalid_empty_rules" label="文件名（可选）" />
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-btn color="primary" variant="text" @click="dialog = false">
          提交
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>