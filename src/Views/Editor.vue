<script setup lang="ts">
import { ref } from 'vue';
import IrEditor from '../Controls/BaseIrEditor/IrEditor.vue';

const content = ref('<p>初始内容</p>')
</script>
<template>
  <v-sheet>
    <IrEditor v-model="content" placeholder="写点什么吧"/>
  </v-sheet>
</template>