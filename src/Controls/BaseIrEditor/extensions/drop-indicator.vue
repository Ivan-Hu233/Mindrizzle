<script setup lang="ts">
import { DropIndicator as BaseDropIndicator } from 'prosekit/vue/drop-indicator'
</script>

<template>
  <BaseDropIndicator class="block-drop-indicator" />
</template>

<style scoped>
.block-drop-indicator {
  z-index: 50;
  transition: all 0.15s ease;
  background-color: rgb(var(--v-theme-primary));
}
</style>
