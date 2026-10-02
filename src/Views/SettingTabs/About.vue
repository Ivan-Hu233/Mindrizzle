<script setup lang="ts">
import { mdiArrowTopRight, mdiCloudOutline } from '@mdi/js'
</script>

<template>
  <v-sheet color="surface">
    <v-container class="py-8 py-sm-10">
      <v-row align="center" class="mb-8">
        <v-col cols="auto">
          <v-avatar color="primary" variant="tonal" rounded="lg" size="72">
            <v-icon :icon="mdiCloudOutline" size="34" />
          </v-avatar>
        </v-col>
        <v-col>
          <v-card-subtitle class="text-overline text-primary pa-0">关于应用</v-card-subtitle>
          <v-card-title class="text-h5 font-weight-medium pa-0">Mindrizzle</v-card-title>
          <v-card-text class="text-body-1 text-medium-emphasis pa-0">让想法在一张无限画布上自然生长。</v-card-text>
        </v-col>
        <v-col cols="auto" class="align-self-start">
          <v-chip color="primary" variant="tonal" size="small">版本 0.1.0</v-chip>
        </v-col>
      </v-row>

      <v-divider class="my-6" />

      <section>
        <v-row align="center" class="mb-3">
          <v-col>
            <v-card-subtitle class="text-overline text-primary pa-0">项目信息</v-card-subtitle>
            <v-card-title class="text-h6 pa-0">为思考留出空间</v-card-title>
          </v-col>
          <v-col cols="auto">
            <v-icon :icon="mdiArrowTopRight" color="medium-emphasis" />
          </v-col>
        </v-row>
        <v-card-text class="text-body-1 text-medium-emphasis pa-0">
          Mindrizzle 是一款本地优先的桌面笔记应用。把笔记放到画布上，自由组织内容、连接线索，慢慢整理出自己的思路。
        </v-card-text>
        <v-row density="compact" class="mt-4">
          <v-col v-for="item in [
            { title: '应用版本', value: '0.1.0' },
            { title: '运行环境', value: '桌面应用' },
            { title: '笔记格式', value: '.mdrf' },
          ]" :key="item.title" cols="12" sm="4">
            <v-list-item :title="item.title" :subtitle="item.value" />
          </v-col>
        </v-row>
      </section>

      <v-divider class="my-6" />

      <v-row align="center" justify="space-between" class="text-medium-emphasis">
        <v-col cols="auto" class="text-body-2">用清晰的空间，装下纷杂的念头。</v-col>
        <v-col cols="auto" class="text-caption">M / 2026</v-col>
      </v-row>
    </v-container>
  </v-sheet>
</template>