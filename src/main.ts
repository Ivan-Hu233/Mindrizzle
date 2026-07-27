import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'

import vuetify from './Vuetify.ts'

import NoteSet from './Views/NoteSets.vue'
import Noteboard from './Views/NoteBoard.vue'
import Setting from './Views/Settings.vue'
import Editor from './Views/Editor.vue'
import Debug from './Views/Debug.vue'

const routes = [
  { path: '/', redirect: '/set' },
  { path: '/set', component: NoteSet },
  { path: '/board', component: Noteboard },
  { path: '/debug', component: Debug },
  { path: '/editor/:file_name', component: Editor },
  { path: '/settings/:tab', component: Setting },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes,
})

createApp(App).use(vuetify).use(router).mount('#app')