<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { clearLocalNotes } from '../utils/localNoteStore';

const router = useRouter()
const path = ref("")
const isCleared = ref(false)

const clearWebStorage = () => {
  clearLocalNotes()
  isCleared.value = true
}
</script>
<template>
  <v-container>
    <v-row>
      <v-col>
        <v-text-field v-model="path" label="路由"/>
      </v-col>
      <v-col cols="auto">
        <v-btn @click="router.push(path)">跳转</v-btn>
      </v-col>
    </v-row>
    <v-row>
      <v-btn @click="clearWebStorage">清除浏览器测试用的网页储存</v-btn>
    </v-row>
    <v-snackbar v-model="isCleared" timeout="1500">已清除网页端笔记存档</v-snackbar>
  </v-container>
</template>