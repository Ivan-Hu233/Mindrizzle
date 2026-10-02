<script setup lang="ts">
import { inject, ref } from 'vue';
import { mdiNoteOffOutline, mdiPencil, mdiPlus } from '@mdi/js';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { info } from '@tauri-apps/plugin-log';

import NewFileDialog from '../Controls/NewFileDialog.vue';
import { loadEditorComponent, storePendingEditorBody, type EditorBodyResult } from '../utils/editorRoute'
import { invokeCommand } from '../utils/invoke'
import { isDebugLoadingEnabled, noteLoadControllerKey, startEditorTransitionKey } from '../utils/routeTransition'

const startEditorTransition = inject(startEditorTransitionKey)!
const noteLoadController = inject(noteLoadControllerKey)!
let editorPreload: Promise<unknown> | undefined

function preloadEditor() {
  if (editorPreload) return editorPreload
  // 预加载失败不影响点击时由路由重新加载
  editorPreload = loadEditorComponent().catch(() => undefined)
  return editorPreload
}

async function prepareEditor(fileName: string) {
  noteLoadController.setName(fileName)
  let unlisten: (() => void) | undefined
  if (isTauri()) {
    unlisten = await listen<number>('file-load-progress', (event) => {
      noteLoadController.setProgress(event.payload)
    })
  }
  const bodyPromise: Promise<EditorBodyResult> = invokeCommand<{ content: string }>('get_mdr_file_body', {
    fileName,
    debugProgress: isDebugLoadingEnabled.value,
  }).then(
    (body) => ({ content: body.content ?? '' }),
    (error: unknown) => ({ error }),
  )
  storePendingEditorBody(fileName, bodyPromise)
  try {
    await Promise.all([preloadEditor(), bodyPromise])
  } finally {
    unlisten?.()
  }
}

async function openEditor(index: number) {
  noteSets.value[index].loading = true
  try {
    await startEditorTransition(
      { name: 'editor', params: { fileName: fileListRef.value[index] } },
      () => prepareEditor(fileListRef.value[index]),
    )
  } finally {
    noteSets.value[index].loading = false
  }
}

const isCreateDialogOpen = ref(false)

loadNoteSets();

let isError = ref(false);
const noteSets = ref<
  { name: string; description: string; tag?: string; updatedAt: number; loading: boolean }[]
>([]);

const MILLIS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;

const relativeTime = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

// 因 Date 只能给出绝对时间，故按分钟/小时/天折算，超过一月退回日期
function formatUpdatedAt(timestamp: number): string {
  if (!timestamp) return '未知';
  const minutes = Math.round((timestamp - Date.now()) / MILLIS_PER_MINUTE);
  if (Math.abs(minutes) < MINUTES_PER_HOUR) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (Math.abs(hours) < HOURS_PER_DAY) return relativeTime.format(hours, 'hour');
  const days = Math.round(hours / HOURS_PER_DAY);
  if (Math.abs(days) < DAYS_PER_MONTH) return relativeTime.format(days, 'day');
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

const fileListRef = ref<string[]>([]);

async function loadNoteSets() {
  try {
    const fileList = await invokeCommand<string[]>('fetch_file_list');
    fileListRef.value = fileList;
    for (const fileName of fileList) {
      const fileInfo = await invokeCommand<{ title: string; description: string; tag: string; updatedAt: number }>(
        'get_mdr_file_meta',
        { fileName: fileName }
      );
      noteSets.value.push({
        name: fileInfo.title,
        description: fileInfo.description,
        tag: fileInfo.tag,
        updatedAt: fileInfo.updatedAt,
        loading: false,
      });
    }
    // 网页端无 IPC，日志插件的 invoke 会抛错
    if (isTauri()) info(`读取笔记元信息成功，共 ${noteSets.value.length} 条`)
  } catch (error) {
    isError.value = true;
  }
}
</script>
<template>
  <v-sheet class="pa-4" elevation="0">
    <v-snackbar v-model="isError" timeout="2000">
      Oh no!便签怎么皱成一团了！
    </v-snackbar>
    <v-empty-state v-if="noteSets.length === 0"
    :icon="mdiNoteOffOutline"
    title = "还没有便签……"
    text = "点击右下角的 + 按钮创建新的便签集" />
    <v-list v-else class="overflow-visible">
      <v-card v-for="(noteSet, index) in noteSets" :key="index" class="mb-4">
        <v-card-title>
          {{ noteSet.name }}
        </v-card-title>
        <v-card-subtitle>
          上次编辑：{{ formatUpdatedAt(noteSet.updatedAt) }}
        </v-card-subtitle>
        <v-card-text>
          {{ noteSet.description }}
        </v-card-text>
        <v-card-actions>
          <v-btn
            @click="openEditor(index)"
            @pointerenter="preloadEditor"
            @focus="preloadEditor"
            :icon="mdiPencil"
            :loading="noteSet.loading"
            class="ms-2"
            variant="text"
          ></v-btn>
        </v-card-actions>
      </v-card>
    </v-list>
    <v-fab
      :icon="mdiPlus"
      color="primary"
      location="bottom end"
      app
      @click="isCreateDialogOpen = true"
    />
    <NewFileDialog :is-open="isCreateDialogOpen" @update:close="isCreateDialogOpen = $event.status" />
  </v-sheet>
</template>