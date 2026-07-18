<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { ref, watch } from 'vue'
import { error, info, trace } from '@tauri-apps/plugin-log';
import { useRouter } from 'vue-router';

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ 'update:close': [value: { status: boolean }] }>()

let dialog = ref(false)

watch(
  () => props.isOpen,
  (newVal) => {
    dialog.value = newVal
  },
  { immediate: true }
)

watch(() => dialog.value, (newVal) => {
  if (!newVal) {
    emit('update:close', { status: false })
  }
})

const title = ref('')
const description = ref('')
const fileName = ref('')

const shortRules = [
  (v: any) => !!v || '不可为空',
  (v: string) => v.length <= 30 || '太长了'
]

const longRules = [
  (v: any) => !!v || '不可为空',
  (v: string) => v.length <= 1000 || '太长了'
]

function isValidFileName(name: string): boolean {
  if (!name || name.length > 50) return false;
  if (/[\\/:*?"<>|]/.test(name)) return false;
  if (/^\s|[\s.]$/.test(name)) return false;
  const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  if (reserved.includes(name.toUpperCase())) return false;
  return true;
}

const fileNameAsyncError = ref<true | string>(true)

let debounceTimer: number | null = null
const debouncedCheck = (name: string) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(async () => {
    trace("检查文件名是否合规")
    if (!name) {
      fileNameAsyncError.value = true
      return
    }
    if (!isValidFileName(name)) {
      fileNameAsyncError.value = '文件名必须非空、长度≤50、不含 \ / : * ? " < > |，不以空格开头或空格/点结尾，且不能是 Windows 保留设备名（如 CON、NUL 等，不区分大小写）。'
      return
    }
    try {
      const valid = await invoke<boolean>('is_file_name_valid', { fileName: name })
      fileNameAsyncError.value = valid ? true : '文件名已被占用'
    } catch(e) {
      if(e instanceof Error){
        error(e.message)
      }
      fileNameAsyncError.value = '校验失败，请重试'
    }
  }, 500)
}

watch(fileName, (newVal) => debouncedCheck(newVal))

const fileRules = [
  () => fileNameAsyncError.value   // 返回错误信息或 true
]

const infoForm = ref()
const router = useRouter();

async function submit() {
  const { valid } = await infoForm.value.validate();
  if (!valid) return;

  try {
    const result = await invoke('create_hypernote', {
      hypernoteInfo: {
        title: title.value,
        description: description.value,
        tag: ["新笔记"],
        content: "**Hello,world!**",
      },
      fileName: fileName.value,
    });
    dialog.value = false;
    router.push(`/editor/${fileName}`)
  } catch (e) {
    if(e instanceof Error){
      error(e.message)
    }
  }
}
</script>
<template>
  <v-dialog v-model="dialog" max-width="500">
    <v-card>
      <v-card-text>
        <v-form ref="infoForm">
          <v-text-field
            v-model="title"
            :counter="30"
            :rules="shortRules"
            label="标题"
          />
          <v-textarea
            v-model="description"
            :counter="1000"
            :rules="longRules"
            label="描述"
            auto-grow
          />
          <v-text-field
            v-model="fileName"
            :counter="30"
            :rules="fileRules"
            label="文件名（可选）"
            hint="留空则自动生成"
            persistent-hint
          />
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-btn color="error" variant="text" @click="dialog = false">
          取消
        </v-btn>
        <v-spacer />
        <v-btn color="primary" variant="text" @click="submit()">
          提交
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>