import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import vuetify from './Vuetify.ts'
import NoteSet from './Views/NoteSets.vue'
import { routeTransition } from './utils/routeTransition.ts'

const routes = [
  { path: '/', redirect: '/set' },
  { path: '/set', component: NoteSet, meta: { level: 1 } },
  { path: '/board', component: () => import('./Views/NoteBoard.vue'), meta: { level: 2 } },
  { path: '/editor/:fileName', component: () => import('./Views/Editor.vue'), meta: { level: 1 } },
  { path: '/settings/:tab', component: () => import('./Views/Settings.vue'), meta: { level: 3 } },
  { path: '/debug', component: () => import('./Views/Debug.vue'), meta: { level: 4 } },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes,
})

router.beforeEach((to, from) => {
  const toLevel = (to.meta.level as number) ?? 0
  const fromLevel = (from.meta.level as number) ?? 0

  if (toLevel > fromLevel) {
    routeTransition.value = 'VSlideXReverseTransition'
  } else if (toLevel < fromLevel) {
    routeTransition.value = 'VSlideXTransition'
  } else {
    routeTransition.value = 'VFadeTransition'
  }
})

createApp(App).use(vuetify).use(router).mount('#app')