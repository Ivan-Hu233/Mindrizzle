import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'

import vuetify from './Vuetify.ts'

import NoteSet from './Views/NoteSets.vue'

// 首页只依赖 vue 与 Tauri IPC，静态引入可让首屏零等待；
// 其余页面（含整条 ProseKit + highlight.js + KaTeX 编辑器链路）按路由懒加载
const routes = [
  { path: '/', redirect: '/set' },
  { path: '/set', component: NoteSet },
  { path: '/board', component: () => import('./Views/NoteBoard.vue') },
  { path: '/debug', component: () => import('./Views/Debug.vue') },
  { path: '/editor/:fileName', component: () => import('./Views/Editor.vue') },
  { path: '/settings/:tab', component: () => import('./Views/Settings.vue') },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes,
})

createApp(App).use(vuetify).use(router).mount('#app')