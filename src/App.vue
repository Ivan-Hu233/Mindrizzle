<script setup lang="ts">
import { mdiWindowMinimize,
         mdiWindowMaximize,
         mdiWindowClose,
         mdiViewModule,
         mdiMagnify,
         mdiFormatListBulleted,
         mdiCalendarBlankOutline,
         mdiCogOutline,
         mdiPlus } from '@mdi/js'
import { shallowRef } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';

let appWindow: ReturnType<typeof getCurrentWindow> | undefined;
if(isTauri()){
  appWindow = getCurrentWindow();
}

const open = shallowRef(false)
const dialog = shallowRef(false)
</script>

<template>
  <v-app class="container">
    <v-toolbar color="primary" density="compact" style="padding: 0;">
      <div 
        data-tauri-drag-region 
        style="
          display: flex; 
          align-items: center; 
          width: 100%; 
          height: 100%;
        "
      >
        <v-app-bar-nav-icon @click.stop="open = !open" />
        <span
          data-tauri-drag-region 
          class="text-white" 
          style="flex: 1; font-size: 1.25rem; margin-left: 5px;"
        >
          Nope
        </span>
        <v-btn :icon="mdiPlus" @click="dialog = !dialog" />
        <v-btn :icon="mdiMagnify" />
        <v-btn :icon="mdiViewModule" />
      </div>
    </v-toolbar>

    <v-dialog
      v-model="dialog"
      max-width="500"
    >
      <v-card>
        <v-card-text>
          <v-text-field label="标题"/>
          <v-text-field label="文件名"/>
        </v-card-text>

        <v-card-actions>
          <v-btn
            color="primary"
            variant="text"
            @click="dialog = false"
          >
            提交
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-navigation-drawer v-model="open"
        :location="$vuetify.display.mobile ? 'bottom' : undefined"
        temporary>
        <v-list
          :lines="false"
          density="compact"
          nav
        >
          <v-list-item :prepend-icon="mdiFormatListBulleted" title="便签集" @click="$router.push('/set')"/>
          <v-list-item :prepend-icon="mdiCalendarBlankOutline" title="记事板" @click="$router.push('/board')"/>
          <v-list-item :prepend-icon="mdiCogOutline" title="设置" @click="$router.push('/settings/introduce')"/>
        </v-list>
        <v-divider v-if="isTauri()"/>
        <v-list v-if="isTauri()"
          :lines="false"
          density="compact"
          nav
        >
          <v-list-item :prepend-icon="mdiWindowMinimize" title="最小化" @click="appWindow?.minimize()"/>
          <v-list-item :prepend-icon="mdiWindowMaximize" title="最大化" @click="appWindow?.toggleMaximize()"/>
          <v-list-item :prepend-icon="mdiWindowClose" title="关闭" @click="appWindow?.close()"/>
        </v-list>
      </v-navigation-drawer>

    <v-main>
      <RouterView style="height: 100%;" />
    </v-main>
  </v-app>
</template>
<style>
* {
  -webkit-tap-highlight-color: transparent; /* 去移动端高亮 */
}
body, .titlebar, [data-tauri-drag-region] {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}

input, textarea {
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
  user-select: text;
}
</style>
