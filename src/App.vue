<script setup lang="ts">
import {
  mdiBug,
  mdiWindowMinimize,
  mdiWindowMaximize,
  mdiWindowClose,
  mdiViewModule,
  mdiMagnify,
  mdiFormatListBulleted,
  mdiCalendarBlankOutline,
  mdiCogOutline,
  mdiPlus
} from '@mdi/js'
import { computed, onMounted, shallowRef } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';

import NewFileDialog from './Controls/NewFileDialog.vue';
import { attachConsole } from '@tauri-apps/plugin-log';
import { useRouter } from 'vue-router';
import { info, error as logError } from '@tauri-apps/plugin-log';

if (isTauri()) {
  attachConsole();
}

let appWindow: ReturnType<typeof getCurrentWindow> | undefined;
if (isTauri()) {
  appWindow = getCurrentWindow();
}

const router = useRouter();
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

onMounted(async () => {
  await router.isReady()

  try {
    const win = getCurrentWindow();
    await win.show();
    info('Tauri 窗口已显示'); // 调试日志
  } catch (error) {
    logError(getErrorMessage(error))
    info('当前不在 Tauri 环境中，跳过显示');
  }
});

const isDev = computed(() => import.meta.env.DEV);

const menuRef = shallowRef(false)
const newFileRef = shallowRef(false)
</script>

<template>
  <v-app class="container">
    <v-toolbar color="primary" density="compact" style="padding: 0;">
      <div data-tauri-drag-region style="
          display: flex; 
          align-items: center; 
          width: 100%; 
          height: 100%;
        ">
        <v-app-bar-nav-icon @click.stop="menuRef = !menuRef" />
        <span data-tauri-drag-region class="text-white" style="flex: 1; font-size: 1.25rem; margin-left: 5px;">
          Nope
        </span>
        <v-btn :icon="mdiPlus" @click="newFileRef = !newFileRef" />
        <v-btn :icon="mdiMagnify" />
        <v-btn :icon="mdiViewModule" />
      </div>
    </v-toolbar>

    <NewFileDialog :is-open="newFileRef" @update:close="newFileRef = $event.status"/>

    <v-navigation-drawer v-model="menuRef" :location="$vuetify.display.mobile ? 'bottom' : undefined" temporary>
      <v-list :lines="false" density="compact" nav>
        <v-list-item :prepend-icon="mdiFormatListBulleted" title="便签集" @click="$router.push('/set')" />
        <v-list-item :prepend-icon="mdiCalendarBlankOutline" title="记事板" @click="$router.push('/board')" />
        <v-list-item :prepend-icon="mdiCogOutline" title="设置" @click="$router.push('/settings/introduce')" />
      </v-list>
      <v-divider v-if="isDev" />
      <v-list v-if="isDev" :lines="false" density="compact" nav>
        <v-list-item :prepend-icon="mdiBug" title="调试页面" @click="$router.push('/debug')" />
      </v-list>
      <v-divider v-if="isTauri()" />
      <v-list v-if="isTauri()" :lines="false" density="compact" nav>
        <v-list-item :prepend-icon="mdiWindowMinimize" title="最小化" @click="appWindow?.minimize()" />
        <v-list-item :prepend-icon="mdiWindowMaximize" title="最大化" @click="appWindow?.toggleMaximize()" />
        <v-list-item :prepend-icon="mdiWindowClose" title="关闭" @click="appWindow?.close()" />
      </v-list>
    </v-navigation-drawer>

    <v-main class="no-scrollbar">
      <RouterView style="height: 100%;" />
    </v-main>
  </v-app>
</template>
<style>
* {
  -webkit-tap-highlight-color: transparent !important;
  /* 去移动端高亮 */
}

body,
.titlebar,
[data-tauri-drag-region] {
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

input,
textarea {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.no-scrollbar {
  overflow-y: auto;
  height: calc(100vh - 48px);
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
