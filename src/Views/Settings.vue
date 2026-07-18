<script setup>
import about from './SettingTabs/About.vue';
import { ref } from 'vue'

const tab = ref('one')
</script>
<template>
  <v-sheet class="d-flex" elevation="4">
    <v-tabs v-model="tab" color="primary" bg-color="blue-grey-darken-4" direction="vertical"
      slider-color="teal-darken-2">
      <v-tab value="About">关于</v-tab>
    </v-tabs>

    <v-divider vertical></v-divider>

    <v-tabs-window v-model="tab" class="flex-fill">
      <v-tabs-window-item value="About">
        <about />
      </v-tabs-window-item>
    </v-tabs-window>
  </v-sheet>
</template>