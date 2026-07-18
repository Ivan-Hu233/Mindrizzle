import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import App from './App.vue'

import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import NoteSet from './Views/NoteSets.vue'
import Noteboard from './Views/NoteBoard.vue'
import Setting from './Views/Settings.vue'
import Editor from './Views/Editor.vue'

const routes = [
  { path: '/', redirect: '/set' },
  { path: '/set', component: NoteSet },
  { path: '/editor/:file_name', component: Editor },
  { path: '/board', component: Noteboard },
  { path: '/settings/:tab', component: Setting },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes,
})

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'dark',
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi,
    },
  },
  components,
  directives,
})

createApp(App).use(vuetify).use(router).mount('#app')