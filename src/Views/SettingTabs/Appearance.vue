<script setup lang="ts">
import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities'
import { computed, ref } from 'vue'
import { useTheme } from 'vuetify'
import { mdiCheckCircle, mdiImageFilterHdr, mdiPaletteOutline, mdiRestore } from '@mdi/js'
import { isTauri } from '@tauri-apps/api/core'
import { invokeCommand } from '../../utils/invoke'

type MaterialScheme = ReturnType<typeof themeFromSourceColor>['schemes']['light']
type MaterialSchemeColors = ReturnType<MaterialScheme['toJSON']>
type MaterialThemeName = 'light' | 'dark'
type ThemeColorMode = 'default' | 'wallpaper' | 'custom'

const MATERIAL_COLOR_ROLES = [
  ['primary', 'primary'],
  ['on-primary', 'onPrimary'],
  ['secondary', 'secondary'],
  ['on-secondary', 'onSecondary'],
  ['tertiary', 'tertiary'],
  ['on-tertiary', 'onTertiary'],
  ['error', 'error'],
  ['on-error', 'onError'],
  ['background', 'background'],
  ['on-background', 'onBackground'],
  ['surface', 'surface'],
  ['on-surface', 'onSurface'],
  ['surface-variant', 'surfaceVariant'],
  ['on-surface-variant', 'onSurfaceVariant'],
  ['outline', 'outline'],
  ['outline-variant', 'outlineVariant'],
  ['inverse-surface', 'inverseSurface'],
  ['inverse-on-surface', 'inverseOnSurface'],
  ['inverse-primary', 'inversePrimary'],
] as const

// 避免未输入完整的 Hex 色值时触发 Material 色彩算法。
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const theme = useTheme()
const themeOptions = [
  { name: '浅色', themeName: 'light', style: 'theme-light' },
  { name: '深色', themeName: 'dark', style: 'theme-dark' },
  { name: '跟随系统', themeName: 'system', style: 'theme-system' },
] as const
const selectedTheme = computed(() => theme.isSystem.value ? 'system' : theme.name.value)
const selectedThemeLabel = computed(() =>
  themeOptions.find((option) => option.themeName === selectedTheme.value)?.name ?? '跟随系统',
)
const defaultThemes = {
  light: { ...theme.themes.value.light, colors: { ...theme.themes.value.light.colors } },
  dark: { ...theme.themes.value.dark, colors: { ...theme.themes.value.dark.colors } },
}
const defaultPrimaryColor = String(defaultThemes.light.colors.primary)
const selectedColorMode = ref<ThemeColorMode>('default')
const primaryColor = ref(defaultPrimaryColor)
const wallpaperError = ref('')
const isLoadingWallpaper = ref(false)
const canvasColor = ref<string | null>(null)
const currentCanvasColor = computed(() =>
  canvasColor.value ?? String(theme.global.current.value.colors.background),
)

function changeTheme(event: Event, themeName: string) {
  const target = event.currentTarget
  if (themeName === 'light' || themeName === 'dark') applySelectedColor(themeName)
  theme.setTransitionOrigin(target instanceof Element ? target : null)
  void theme.change(themeName, true)
}

function selectColorMode(mode: ThemeColorMode | null) {
  if (!mode) return
  wallpaperError.value = ''
  if (mode === 'wallpaper') {
    void applyWallpaperColor()
    return
  }
  selectedColorMode.value = mode
  if (mode === 'default') {
    primaryColor.value = defaultPrimaryColor
    restoreDefaultThemes()
    return
  }
  applyPrimaryColor(primaryColor.value)
}

async function applyWallpaperColor() {
  if (!isTauri()) return
  isLoadingWallpaper.value = true
  try {
    const color = await invokeCommand<string>('get_wallpaper_primary_color')
    if (!HEX_COLOR_PATTERN.test(color)) throw new Error('系统壁纸没有返回有效颜色')
    primaryColor.value = color
    selectedColorMode.value = 'wallpaper'
    applyPrimaryColor(color)
  } catch (error) {
    wallpaperError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isLoadingWallpaper.value = false
  }
}

function updatePrimaryColor(color: unknown) {
  if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) return
  primaryColor.value = color
  selectedColorMode.value = 'custom'
  applyPrimaryColor(color)
}

function applyPrimaryColor(color: string) {
  applyMaterialTheme(color, 'light', false)
  applyMaterialTheme(color, 'dark', true)
}

function applySelectedColor(themeName: MaterialThemeName) {
  if (selectedColorMode.value === 'default') {
    restoreDefaultThemes()
    return
  }
  applyMaterialTheme(primaryColor.value, themeName, themeName === 'dark')
}

function restoreDefaultThemes() {
  theme.themes.value.light = defaultThemes.light
  theme.themes.value.dark = defaultThemes.dark
}

function applyMaterialTheme(sourceColor: string, themeName: MaterialThemeName, isDark: boolean) {
  const materialTheme = themeFromSourceColor(argbFromHex(sourceColor))
  const scheme = (isDark ? materialTheme.schemes.dark : materialTheme.schemes.light).toJSON()
  const baseTheme = theme.themes.value[themeName]

  theme.themes.value[themeName] = {
    ...baseTheme,
    dark: isDark,
    colors: createGeneratedColors(scheme, baseTheme.colors),
  }
}

function createGeneratedColors(scheme: MaterialSchemeColors, baseColors: typeof theme.themes.value.light.colors) {
  const generatedColors = Object.fromEntries(
    MATERIAL_COLOR_ROLES.map(([themeRole, materialRole]) => [themeRole, hexFromArgb(scheme[materialRole])]),
  )

  return { ...baseColors, ...generatedColors }
}

</script>

<template>
  <v-sheet color="surface">
    <v-container class="py-8 py-sm-10">
      <v-row align="center" justify="space-between" class="mb-7">
        <v-col>
          <v-card-subtitle class="eyebrow text-overline pa-0">界面偏好</v-card-subtitle>
          <v-card-title class="text-h5 font-weight-medium pa-0">外观</v-card-title>
          <v-card-text class="heading-copy text-body-2 pa-0">调整画布与界面的视觉呈现。</v-card-text>
        </v-col>
        <v-col cols="auto">
          <v-icon :icon="mdiPaletteOutline" color="primary" size="30" />
        </v-col>
      </v-row>

      <section>
        <div class="d-flex align-center justify-space-between mb-4">
          <div>
            <v-card-title class="text-subtitle-1 pa-0">主题</v-card-title>
            <v-card-subtitle class="text-body-2 pa-0">选择应用的整体色彩氛围</v-card-subtitle>
          </div>
          <v-chip size="small" color="primary" variant="tonal">{{ selectedThemeLabel }}</v-chip>
        </div>
        <v-row density="compact">
          <v-col v-for="option in themeOptions" :key="option.themeName" cols="4">
            <v-card
              :aria-pressed="selectedTheme === option.themeName"
              variant="flat"
              rounded="sm"
              @click="changeTheme($event, option.themeName)"
            >
              <v-card-text class="pa-2">
                <v-theme-provider theme="light" with-background>
                  <div class="theme-preview d-flex align-center ga-2 pa-3 rounded-sm" :class="option.style">
                    <v-sheet class="preview-sidebar rounded-sm" />
                    <v-sheet class="preview-paper rounded-sm" />
                    <v-avatar class="preview-accent" color="primary" size="7" />
                  </div>
                </v-theme-provider>
              </v-card-text>
              <v-card-item class="py-1">
                <v-card-title class="text-body-2 pa-0">{{ option.name }}</v-card-title>
                <template #append>
                  <v-icon v-if="selectedTheme === option.themeName" :icon="mdiCheckCircle" color="primary" size="18" />
                </template>
              </v-card-item>
            </v-card>
          </v-col>
        </v-row>
      </section>

      <v-divider class="my-6" />

      <section>
        <div class="d-flex align-center justify-space-between mb-4">
          <div>
            <v-card-title class="text-subtitle-1 pa-0">主题色</v-card-title>
            <v-card-subtitle class="text-body-2 pa-0">默认、系统壁纸取色或自定义</v-card-subtitle>
          </div>
          <v-chip size="small" color="primary" variant="tonal">{{ primaryColor }}</v-chip>
        </div>
        <v-btn-toggle
          :model-value="selectedColorMode"
          color="primary"
          divided
          mandatory
          density="comfortable"
          @update:model-value="selectColorMode"
        >
          <v-btn value="default" :prepend-icon="mdiRestore">默认</v-btn>
          <v-btn value="wallpaper" :prepend-icon="mdiImageFilterHdr" :loading="isLoadingWallpaper" :disabled="!isTauri()">
            壁纸取色
          </v-btn>
          <v-btn value="custom" :prepend-icon="mdiPaletteOutline">自定义</v-btn>
        </v-btn-toggle>
        <v-alert v-if="!isTauri()" class="mt-3" density="compact" type="info" variant="tonal">
          浏览器无法读取系统壁纸，请在桌面应用中使用此选项。
        </v-alert>
        <v-alert v-if="wallpaperError" class="mt-3" density="compact" type="warning" variant="tonal">
          {{ wallpaperError }}
        </v-alert>
        <v-row v-if="selectedColorMode === 'custom'" density="compact" class="mt-2">
          <v-col cols="12" sm="6">
            <v-color-input
              :model-value="primaryColor"
              label="主题色"
              mode="hex"
              variant="solo-filled"
              density="compact"
              hide-details
              hide-actions
              @update:model-value="updatePrimaryColor"
            />
          </v-col>
        </v-row>
      </section>

      <v-divider class="my-6" />

      <section>
        <div class="d-flex align-center justify-space-between mb-4">
          <div>
            <v-card-title class="text-subtitle-1 pa-0">画布预览</v-card-title>
            <v-card-subtitle class="text-body-2 pa-0">当前外观下的笔记画布</v-card-subtitle>
          </div>
          <v-chip size="small" color="primary" variant="tonal">100%</v-chip>
        </div>
        <v-card class="canvas-preview" variant="flat" rounded="sm">
          <div class="canvas-grid d-flex align-center justify-center ga-7 pa-6" :style="{ backgroundColor: currentCanvasColor }">
            <v-card class="note note-main d-flex flex-column align-start ga-2 pa-3" elevation="1">
              <v-card-subtitle class="text-caption text-primary pa-0">灵感 · 01</v-card-subtitle>
              <span class="note-line note-line-long" />
              <span class="note-line note-line-short" />
              <v-chip size="x-small" color="primary" variant="tonal">随手记下</v-chip>
            </v-card>
            <v-card class="note note-side d-flex flex-column align-start ga-2 pa-3" elevation="1">
              <v-card-subtitle class="text-caption text-primary pa-0">稍后整理</v-card-subtitle>
              <span class="note-line note-line-long" />
              <span class="note-line note-line-medium" />
            </v-card>
          </div>
        </v-card>
      </section>
    </v-container>
  </v-sheet>
</template>
<style scoped>
.theme-preview {
  height: 76px;
}

.theme-light {
  background: rgba(var(--v-theme-on-surface), 0.12);
}

.theme-dark {
  background: #282e2c;
}

.theme-system {
  background: linear-gradient(110deg, rgba(var(--v-theme-on-surface), 0.12) 0 50%, #282e2c 50%);
}

.preview-sidebar {
  width: 22%;
  height: 100%;
  background: rgba(var(--v-theme-primary), 0.22);
}

.preview-paper {
  width: 48%;
  height: 72%;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 4px rgba(var(--v-theme-on-surface), 0.12);
}

.theme-dark .preview-paper {
  background: #414a46;
}

.theme-system .preview-paper {
  background: linear-gradient(90deg, rgb(var(--v-theme-surface)) 50%, #414a46 50%);
}

.canvas-preview {
  position: relative;
  overflow: hidden;
}

.canvas-grid {
  position: relative;
  min-height: 178px;
  background-image: radial-gradient(rgba(var(--v-theme-on-surface), 0.16) 0.7px, transparent 0.7px);
  background-size: 14px 14px;
}

.note {
  position: relative;
  z-index: 1;
  width: min(40%, 190px);
  min-height: 112px;
  background: rgb(var(--v-theme-surface));
}

.note-side {
  transform: translateY(15px);
  background: rgba(var(--v-theme-primary), 0.08);
}

.note-line {
  height: 5px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.1);
}

.note-line-long { width: 90%; }
.note-line-medium { width: 72%; }
.note-line-short { width: 58%; }

.connection-line {
  position: absolute;
  top: 56%;
  left: 44%;
  width: 13%;
  height: 1px;
  background: rgba(var(--v-theme-primary), 0.6);
  transform: rotate(13deg);
}

.zoom-indicator {
  position: absolute;
  right: 0;
  bottom: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  background: rgb(var(--v-theme-surface));
}
</style>