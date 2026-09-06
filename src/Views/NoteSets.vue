<script setup lang="ts">
import { ref } from 'vue';
import { mdiNoteOffOutline } from '@mdi/js';
import { info } from '@tauri-apps/plugin-log';
import { invokeCommand } from '../utils/invoke'

loadNoteSets();

let isError = false;
const noteSets = ref<
  { name: string; description: string; tag?: string }[]
>([]);

const fileListRef = ref<string[]>([]);

async function loadNoteSets() {
  try {
    const fileList = await invokeCommand<string[]>('fetch_file_list');
    fileListRef.value = fileList;
    for (const fileName of fileList) {
      const fileInfo = await invokeCommand<{ title: string; description: string; tag: string }>(
        'get_omnijot_file_meta',
        { fileName: fileName }
      );
      noteSets.value.push({
        name: fileInfo.title,
        description: fileInfo.description,
        tag: fileInfo.tag,
      });
    }
    info(`读取笔记元信息成功，共 ${noteSets.value.length} 条`)
  } catch (error) {
    isError = true;
  }
}
</script>
<template>
  <v-sheet>
    <v-alert v-if="isError" type="error">
      Oh no!便签怎么皱成一团了！
    </v-alert>
    <v-empty-state v-else-if="noteSets.length === 0"
    :icon="mdiNoteOffOutline"
    title = "还没有便签……"
    text = "点击右上角的 + 按钮创建新的便签集" />
    <v-list v-else>
      <v-list-item v-for="(noteSet, index) in noteSets" :key="index"
        :title="noteSet.name" @click="$router.push('/editor/' + fileListRef[index])"
        :subtitle="noteSet.description" />
    </v-list>
  </v-sheet>
</template>