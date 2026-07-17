<script setup lang="ts">
import { ref } from 'vue';
import { mdiNoteOffOutline } from '@mdi/js';
import { invoke } from '@tauri-apps/api/core'

loadNoteSets();


let isError = false;
const noteSets = ref<
  { name: string; description: string; tag?: string }[]
>([]);

async function loadNoteSets() {
  try {
    // 获取文件列表
    const fileList = await invoke<string[]>('fetch_file_list');
    // 遍历文件列表
    for (const fileName of fileList) {
      const fileInfo = await invoke<{ title: string; description: string; tag: string }>(
        'get_file_info',
        { file_name: fileName }
      );
      noteSets.value.push({
        name: fileInfo.title,
        description: fileInfo.description,
        tag: fileInfo.tag,
      });
    }
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
      <v-list-item v-for="(noteSet, index) in noteSets" :key="index">
        <v-list-item-content>
          <v-list-item-title>{{ noteSet.name }}</v-list-item-title>
          <v-list-item-subtitle>{{ noteSet.description }}</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </v-list>
  </v-sheet>
</template>