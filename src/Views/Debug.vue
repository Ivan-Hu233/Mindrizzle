<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter()
const path = ref("")
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
  </v-container>
</template>