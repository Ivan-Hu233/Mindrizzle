<script setup lang="ts">
import { ref } from 'vue';
import { mdiNoteOffOutline, mdiPencil, mdiPlus } from '@mdi/js';
import { isTauri } from '@tauri-apps/api/core';
import { info } from '@tauri-apps/plugin-log';

import NewFileDialog from '../Controls/NewFileDialog.vue';
import { invokeCommand } from '../utils/invoke'

const isCreateDialogOpen = ref(false)

loadNoteSets();

let isError = ref(false);
const noteSets = ref<
  { name: string; description: string; tag?: string; updatedAt: number }[]
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
          <v-btn @click="$router.push('/editor/' + fileListRef[index])"
            :icon="mdiPencil"
            class="ms-2"
            variant="text"
          ></v-btn>
        </v-card-actions>
      </v-card>
      <!-- <v-list-item v-for="(noteSet, index) in noteSets" :key="index"
        :title="noteSet.name" @click="$router.push('/editor/' + fileListRef[index])"
        :subtitle="noteSet.description" /> -->
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