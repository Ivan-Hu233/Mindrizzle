<template>
  <v-sheet class="code-editor-container">
    <div class="toolbar">
      <v-select
        v-model="currentLanguage"
        :items="languageOptions"
        label="语言"
        variant="solo"
        density="compact"
        hide-details
        class="language-select"
      />
      <v-btn
        variant="text"
        :icon="mdiContentCopy"
        size="x-small"
        @click="copyCode"
        title="复制代码"
      />
    </div>

    <div class="code-editor-wrapper" ref="wrapperRef">
      <pre class="highlight-layer"><code ref="highlightRef" :class="`language-${currentLanguage}`"></code></pre>
      <textarea
        ref="textareaRef"
        v-model="internalCode"
        class="edit-layer"
        :style="{ caretColor: String(primaryColor) }"
        spellcheck="false"
        @scroll="syncScroll"
        @input="onInput"
        @keydown="handleKeydown"
      ></textarea>
    </div>

    <v-snackbar
      v-model="snackbar"
      :timeout="1500"
      color="success"
      location="top"
    >
      代码已复制到剪贴板
    </v-snackbar>
  </v-sheet>
</template>
<script lang="ts">
import type { ResizeConstraints } from '../resizeConstraints'

export const resizeConstraints: ResizeConstraints = {
  minWidth: 330,
  maxWidth: null,
  minHeight: 210,
  maxHeight: null,
}
</script>
<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed, onBeforeUnmount } from 'vue';
import { useTheme } from 'vuetify';
import { mdiContentCopy } from '@mdi/js';
import hljs from 'highlight.js/lib/core';

import githubCss from 'highlight.js/styles/github.css?raw';
import atomDarkCss from 'highlight.js/styles/atom-one-dark.css?raw';

import { info, warn, error as logError } from '@tauri-apps/plugin-log';

import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('vue', xml);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);

const theme = useTheme();
const isDark = computed(() => theme.global.name.value === 'dark');
const primaryColor = computed(() => theme.global.current.value.colors.primary);

const styleId = 'hljs-theme-local';
let styleElement: HTMLStyleElement | null = null;

const applyTheme = (dark: boolean) => {
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = styleId;
    document.head.appendChild(styleElement);
  }
  const baseTheme = dark ? atomDarkCss : githubCss;
  styleElement.textContent = baseTheme;
};

watch(isDark, (dark) => {
  applyTheme(dark);
}, { immediate: true });

const languageOptions = [
  { title: '纯文本', value: 'plaintext' },
  { title: 'JavaScript', value: 'javascript' },
  { title: 'TypeScript', value: 'typescript' },
  { title: 'Python', value: 'python' },
  { title: 'HTML', value: 'html' },
  { title: 'CSS', value: 'css' },
  { title: 'JSON', value: 'json' },
  { title: 'Bash / Shell', value: 'bash' },
  { title: 'C', value: 'c' },
  { title: 'C++', value: 'cpp' },
  { title: 'Java', value: 'java' },
  { title: 'Go', value: 'go' },
  { title: 'Rust', value: 'rust' },
  { title: 'Vue', value: 'vue' },
  { title: 'PHP', value: 'php' },
  { title: 'Ruby', value: 'ruby' },
  { title: 'Swift', value: 'swift' },
  { title: 'Kotlin', value: 'kotlin' },
];

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'plaintext',
  },
});

const emit = defineEmits(['update:modelValue', 'update:language']);
const internalCode = ref(props.modelValue);
const currentLanguage = ref(props.language);

const snackbar = ref(false);

const highlightRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);

const renderHighlight = () => {
  const codeElement = highlightRef.value;
  if (!codeElement) return;
  const code = internalCode.value || '';
  try {
    let highlighted;
    const lang = currentLanguage.value;
    if (lang && lang !== 'plaintext' && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang });
    } else {
      highlighted = hljs.highlightAuto(code);
    }
    codeElement.innerHTML = highlighted.value;
  } catch (error) {
    warn('高亮失败，使用纯文本: ' + (error instanceof Error ? error.message : String(error)));
    codeElement.textContent = code;
  }
};

const onInput = () => {
  emit('update:modelValue', internalCode.value);
  renderHighlight();
};

// 因需在浏览器重排后同步滚动位置，故用 requestAnimationFrame
const syncScroll = () => {
  const textarea = textareaRef.value;
  const pre = highlightRef.value?.parentElement;
  if (pre && textarea) {
    requestAnimationFrame(() => {
      pre.scrollTop = textarea.scrollTop;
      pre.scrollLeft = textarea.scrollLeft;
    });
  }
};

const copyCode = async () => {
  const text = internalCode.value;
  if (!text) {
    warn('没有代码可复制');
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      info('复制成功 (Clipboard API)');
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      info('复制成功 (execCommand)');
    }
    snackbar.value = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('复制失败: ' + message);
    alert('复制失败，请手动复制代码。\n错误信息：' + message);
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  const textarea = textareaRef.value;
  if (!textarea) return;

  const key = event.key;
  const pairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
  };

  if (!(key in pairs)) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = internalCode.value;

  if (start !== end) {
    event.preventDefault();
    const selected = text.substring(start, end);
    const left = key;
    const right = pairs[key];
    const newText = text.substring(0, start) + left + selected + right + text.substring(end);
    internalCode.value = newText;
    nextTick(() => {
      textarea.selectionStart = start + 1;
      textarea.selectionEnd = end + 1;
      textarea.focus({ preventScroll: true });
    });
    emit('update:modelValue', newText);
    renderHighlight();
    return;
  }

  event.preventDefault();
  const left = key;
  const right = pairs[key];
  const newText = text.substring(0, start) + left + right + text.substring(end);
  internalCode.value = newText;
  nextTick(() => {
    textarea.selectionStart = start + 1;
    textarea.selectionEnd = start + 1;
    textarea.focus({ preventScroll: true });
  });
  emit('update:modelValue', newText);
  renderHighlight();
};

watch(
  () => props.language,
  (newLang) => {
    if (newLang !== currentLanguage.value) {
      currentLanguage.value = newLang;
      nextTick(renderHighlight);
    }
  }
);

watch(currentLanguage, (newLang) => {
  emit('update:language', newLang);
  nextTick(renderHighlight);
});

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal !== internalCode.value) {
      internalCode.value = newVal;
      nextTick(renderHighlight);
    }
  }
);

const resizeObserver = ref<ResizeObserver | null>(null);
onMounted(() => {
  nextTick(() => {
    renderHighlight();
    syncScroll();
    if (textareaRef.value) {
      textareaRef.value.focus({ preventScroll: true });
    }
  });

  if (window.ResizeObserver && wrapperRef.value) {
    resizeObserver.value = new ResizeObserver(() => {
      syncScroll();
    });
    resizeObserver.value.observe(wrapperRef.value);
  }
});

onBeforeUnmount(() => {
  if (resizeObserver.value) {
    resizeObserver.value.disconnect();
  }
  if (styleElement && styleElement.parentNode) {
    styleElement.parentNode.removeChild(styleElement);
    styleElement = null;
  }
});

// 因父组件需统一调用保存/加载而不按组件类型特判，故暴露统一的 saveConfig/loadConfig
defineExpose({
  saveConfig() {
    return { code: internalCode.value, language: currentLanguage.value };
  },
  loadConfig(config: { code?: string; language?: string }) {
    if (config?.code != null) internalCode.value = config.code;
    if (config?.language != null) currentLanguage.value = config.language;
    nextTick(renderHighlight);
  },
});
</script>

<style scoped>

.code-editor-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* 因块随 zoom 重排版放大，固定尺寸按 --canvas-zoom 缩放保持协调 */
  min-width: calc(300px * var(--canvas-zoom, 1));
  min-height: calc(200px * var(--canvas-zoom, 1));
}


.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(2px * var(--canvas-zoom, 1)) calc(6px * var(--canvas-zoom, 1));
  background-color: var(--v-theme-surface, #f6f8fa);
  border: 1px solid var(--v-theme-border, #e1e4e8);
  border-bottom: none;
  border-radius: calc(6px * var(--canvas-zoom, 1)) calc(6px * var(--canvas-zoom, 1)) 0 0;
}

.language-select {
  max-width: calc(160px * var(--canvas-zoom, 1));
  font-size: calc(13px * var(--canvas-zoom, 1));
}


.code-editor-wrapper {
  position: relative;
  border: 1px solid var(--v-theme-border, #e1e4e8);
  border-top: none;
  border-radius: 0 0 calc(6px * var(--canvas-zoom, 1)) calc(6px * var(--canvas-zoom, 1));
  overflow: hidden;
  background-color: var(--v-theme-surface, #f6f8fa);
  flex: 1;
}


.highlight-layer,
.edit-layer {
  margin: 0;
  padding: calc(12px * var(--canvas-zoom, 1)) calc(16px * var(--canvas-zoom, 1));
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  font-size: calc(14px * var(--canvas-zoom, 1));
  line-height: 1.6;
  font-weight: normal;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  tab-size: 2;
  white-space: pre;
  word-wrap: normal;
  word-break: normal;
  border: none;
  outline: none;
  resize: none;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  min-height: calc(120px * var(--canvas-zoom, 1));


  font-variant-ligatures: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}


.highlight-layer {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  z-index: 1;
  background-color: transparent !important;
  pointer-events: none;
  margin: 0;
  padding: calc(12px * var(--canvas-zoom, 1)) calc(16px * var(--canvas-zoom, 1));
  border-radius: 0;
  overflow: auto;

}

.highlight-layer code {
  display: block;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  background: transparent !important;
  padding: 0;
  border: none;
}


.edit-layer {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  background-color: transparent;
  color: transparent;
  padding: calc(12px * var(--canvas-zoom, 1)) calc(16px * var(--canvas-zoom, 1));
  border-radius: 0;
  height: 100%;
  min-height: inherit;


  scrollbar-width: auto;
  -ms-overflow-style: auto;
}


.edit-layer::-webkit-scrollbar,
.highlight-layer::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.edit-layer::-webkit-scrollbar-thumb,
.highlight-layer::-webkit-scrollbar-thumb {
  background: var(--v-theme-border, #d1d5da);
  border-radius: 4px;
}
.edit-layer::-webkit-scrollbar-track,
.highlight-layer::-webkit-scrollbar-track {
  background: transparent;
}
</style>