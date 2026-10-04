<script setup lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { mdiCheck, mdiClose, mdiContentCopy, mdiGithub, mdiInformationOutline } from '@mdi/js'
import { computed, ref } from 'vue'
import packageInfo from '../../../package.json'
import appIconUrl from '../../../app-icon.svg'

const isDiagnosticsOpen = ref(false)
const isGitCommitLoaded = ref(!isTauri())
const gitCommit = ref(isTauri() ? '读取中' : '不可用（网页预览）')
const isCopyComplete = ref(false)
const copyError = ref('')
const appVersion = packageInfo.version
const copyrightYear = new Date().getFullYear()
const environment = computed(() => isTauri() ? 'Tauri 桌面应用' : '浏览器预览')
const systemPlatform = navigator.platform || '未知'
const browserInfo = navigator.userAgent
const screenSize = `${window.screen.width} × ${window.screen.height}`
const openSourceProjects = [
  { name: 'Vue', url: 'https://github.com/vuejs/core' },
  { name: 'Vuetify', url: 'https://github.com/vuetifyjs/vuetify' },
  { name: 'Tauri', url: 'https://github.com/tauri-apps/tauri' },
  { name: 'ProseKit', url: 'https://github.com/ocavue/prosekit' },
  { name: 'ProseMirror', url: 'https://github.com/ProseMirror/prosemirror' },
  { name: 'KaTeX', url: 'https://github.com/KaTeX/KaTeX' },
  { name: 'highlight.js', url: 'https://github.com/highlightjs/highlight.js' },
]
const diagnostics = computed(() => [
  { title: '应用版本', value: appVersion },
  { title: 'Git 提交', value: gitCommit.value },
  { title: '运行环境', value: environment.value },
  { title: '系统平台', value: systemPlatform },
  { title: '浏览器', value: browserInfo },
  { title: '屏幕尺寸', value: screenSize },
  { title: '语言', value: navigator.language },
])
const diagnosticText = computed(() => [
  `应用版本：${appVersion}`,
  `Git 提交：${gitCommit.value}`,
  `运行环境：${environment.value}`,
  `系统平台：${systemPlatform}`,
  `浏览器：${browserInfo}`,
  `屏幕尺寸：${screenSize}`,
  `语言：${navigator.language}`,
].join('\n'))

async function openDiagnostics() {
  isDiagnosticsOpen.value = true
  if (!isTauri() || isGitCommitLoaded.value) return

  try {
    gitCommit.value = await invoke<string>('get_git_commit')
  } catch {
    gitCommit.value = '未知'
  } finally {
    isGitCommitLoaded.value = true
  }
}

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(diagnosticText.value)
    isCopyComplete.value = true
    copyError.value = ''
  } catch {
    copyError.value = '无法访问剪贴板，请检查系统权限。'
  }
}
</script>

<template>
  <v-sheet color="surface" class="about-surface">
    <v-container class="about-page py-6 py-sm-8">
      <section class="about-hero">
        <div class="about-hero-main">
          <v-avatar class="about-mark" rounded="lg" aria-hidden="true">
            <img :src="appIconUrl" alt="" width="64" height="64" />
          </v-avatar>
          <div class="about-copy">
            <div class="about-eyebrow">关于应用 <span>Catch your mind drizzle.</span></div>
            <h1>Mindrizzle</h1>
            <p>让想法有处可落，让笔记自然成形。</p>
          </div>
        </div>
        <div class="about-build">
          <div class="build-item">
            <span>版本</span>
            <strong>{{ appVersion }}</strong>
          </div>
          <v-divider class="build-separator" vertical />
          <div class="build-item">
            <span>Git 提交</span>
            <strong>{{ gitCommit }}</strong>
          </div>
        </div>
      </section>

      <div class="about-bottom">
        <div class="about-actions">
          <v-btn
            href="https://github.com/LogicAurora/Mindrizzle"
            target="_blank"
            rel="noopener noreferrer"
            :prepend-icon="mdiGithub"
            variant="text"
          >GitHub</v-btn>
          <v-btn
            :prepend-icon="mdiInformationOutline"
            color="primary"
            variant="tonal"
            @click="openDiagnostics"
          >诊断信息</v-btn>
        </div>
      </div>

      <section class="about-credits" aria-label="开源鸣谢与版权信息">
        <div class="credits-heading">
          <h2>特别鸣谢</h2>
          <p>感谢开源项目与社区贡献者，让 Mindrizzle 得以持续成长。</p>
        </div>
        <div class="credits-projects">
          <a
            v-for="project in openSourceProjects"
            :key="project.name"
            :href="project.url"
            target="_blank"
            rel="noopener noreferrer"
          >{{ project.name }}</a>
        </div>
        <div class="credits-footer">
          <div class="credits-links">
            <a href="https://github.com/LogicAurora/Mindrizzle/graphs/contributors" target="_blank" rel="noopener noreferrer">
              贡献者
            </a>
            <a href="https://github.com/LogicAurora/Mindrizzle/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">
              GNU GPL v3.0
            </a>
          <span>在此，特别感谢每一位为Mindrizzle做出贡献的开发者！！！</span>
          </div>
          <span>版权所有 © {{ copyrightYear }} LogicAurora</span>
        </div>
      </section>
    </v-container>

    <v-dialog v-model="isDiagnosticsOpen" max-width="560">
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <span>诊断信息</span>
          <v-btn :icon="mdiClose" variant="text" aria-label="关闭" @click="isDiagnosticsOpen = false" />
        </v-card-title>
        <v-card-text>
          <v-list density="compact" lines="two">
            <v-list-item v-for="item in diagnostics" :key="item.title" :title="item.title" :subtitle="item.value" />
          </v-list>
          <v-alert v-if="copyError" class="mt-2" density="compact" type="error" variant="tonal">
            {{ copyError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            :prepend-icon="isCopyComplete ? mdiCheck : mdiContentCopy"
            variant="text"
            @click="copyDiagnostics"
          >{{ isCopyComplete ? '已复制' : '复制诊断信息' }}</v-btn>
          <v-btn variant="text" @click="isDiagnosticsOpen = false">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-sheet>
</template>

<style scoped>
.about-page {
  max-width: 960px;
}

.about-hero {
  position: relative;
  display: flex;
  min-height: 236px;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: 28px 32px 20px;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-primary));
  background-color: rgb(var(--v-theme-primary));
  background-image: linear-gradient(135deg, rgba(var(--v-theme-on-primary), 0.07) 1px, transparent 1px);
  background-size: 22px 22px;
}

.about-hero-main {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}

.about-mark {
  display: grid;
  width: 68px;
  height: 68px;
  flex: 0 0 68px;
  place-items: center;
  background: transparent;
}

.about-copy {
  min-width: 0;
  padding-top: 1px;
}

.about-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.75rem;
  font-weight: 600;
  opacity: 0.82;
}

.about-eyebrow span {
  padding-left: 10px;
  border-left: 1px solid rgba(var(--v-theme-on-primary), 0.38);
  font-size: 0.65rem;
  font-weight: 500;
}

.about-copy h1 {
  margin-top: 8px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 2.35rem;
  font-weight: 500;
  line-height: 1.1;
}

.about-copy p {
  max-width: 490px;
  margin-top: 10px;
  font-size: 0.95rem;
  line-height: 1.65;
  opacity: 0.88;
}

.about-build {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-left: 88px;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-primary), 0.22);
}

.build-item {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  font-size: 0.78rem;
}

.build-item span {
  opacity: 0.7;
}

.build-item strong {
  overflow-wrap: anywhere;
  font-weight: 600;
}

.build-separator {
  width: 1px;
  height: 14px;
  background: rgba(var(--v-theme-on-primary), 0.3);
}

.about-bottom {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 4px 0;
}

.about-credits {
  padding: 18px 4px 4px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.credits-heading h2 {
  font-size: 0.9rem;
  font-weight: 600;
}

.credits-heading p {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.8rem;
  line-height: 1.5;
}

.credits-projects,
.credits-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.credits-projects {
  margin-top: 12px;
}

.credits-projects a,
.credits-links a {
  color: rgb(var(--v-theme-primary));
  font-size: 0.8rem;
  text-decoration: none;
}

.credits-projects a:hover,
.credits-links a:hover {
  text-decoration: underline;
}

.credits-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 20px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
}

.credits-links {
  gap: 8px 14px;
}

.about-principles,
.about-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.about-principles {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.85rem;
  font-weight: 500;
}

.principle-mark {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}

.principle-divider {
  margin: 0 3px;
  opacity: 0.45;
}

@media (max-width: 600px) {
  .about-hero {
    min-height: 0;
    justify-content: flex-start;
    gap: 12px;
    padding: 18px 20px 16px;
  }

  .about-hero-main {
    gap: 14px;
  }

  .about-mark {
    width: 58px;
    height: 58px;
    flex-basis: 58px;
  }

  .about-copy h1 {
    font-size: 2rem;
  }

  .about-copy p {
    font-size: 0.875rem;
  }

  .about-build {
    gap: 10px;
    margin-left: 72px;
  }

  .build-item {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .about-bottom {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    padding-top: 14px;
  }

  .about-actions {
    width: 100%;
  }

  .credits-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>