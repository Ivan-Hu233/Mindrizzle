<script setup>
import about from './SettingTabs/About.vue';
import appearance from './SettingTabs/Appearance.vue';
import { ref } from 'vue'

const tab = ref("About")
</script>
<template>
  <v-sheet elevation="4">
    <v-tabs v-model="tab" color="primary" center-active>
      <v-tab value="About">关于</v-tab>
      <v-tab value="Appearance">外观</v-tab>
    </v-tabs>

    <v-divider></v-divider>

    <v-tabs-window v-model="tab" class="flex-fill">
      <v-tabs-window-item value="About">
        <about />
      </v-tabs-window-item>
      <v-tabs-window-item value="Appearance">
        <appearance />
      </v-tabs-window-item>
    </v-tabs-window>
  </v-sheet>
</template>