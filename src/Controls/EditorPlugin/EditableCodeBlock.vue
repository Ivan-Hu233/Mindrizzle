<template>
  <div
    class="code-editor-container"
    :style="{
      minWidth,
      minHeight,
      maxWidth: maxWidth || 'none',
      maxHeight: maxHeight || 'none'
    }"
  >
    <!-- 工具栏 -->
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

    <!-- 编辑器主体 -->
    <div class="code-editor-wrapper" ref="wrapperRef">
      <pre class="highlight-layer"><code ref="highlightRef" :class="`language-${currentLanguage}`"></code></pre>
      <textarea
        ref="textareaRef"
        v-model="internalCode"
        class="edit-layer"
        :style="{ caretColor: primaryColor }"
        spellcheck="false"
        @scroll="syncScroll"
        @input="onInput"
        @keydown="handleKeydown"
      ></textarea>
    </div>

    <!-- 复制成功提示 -->
    <v-snackbar
      v-model="snackbar"
      :timeout="1500"
      color="success"
      location="top"
    >
      代码已复制到剪贴板
    </v-snackbar>
  </div>
</template>
<script lang="ts">
export const resizeConstraints = {
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

// ----- 注册语言（大幅扩充）-----
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

// ----- 本地导入主题样式 -----
import githubCss from 'highlight.js/styles/github.css?raw';
import atomDarkCss from 'highlight.js/styles/atom-one-dark.css?raw';

import { info , error as logError } from '@tauri-apps/plugin-log';

// ----- Vuetify 主题 -----
const theme = useTheme();
const isDark = computed(() => theme.global.name.value === 'dark');
const primaryColor = computed(() => theme.global.current.value.colors.primary);

// ----- 动态注入样式标签 -----
const styleId = 'hljs-theme-local';
let styleElement = null;

const applyTheme = (dark) => {
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

// ----- 语言选项（丰富列表）-----
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

// ----- Props（新增 maxWidth/maxHeight）-----
const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'plaintext',
  },
  minWidth: {
    type: String,
    default: '300px',
  },
  minHeight: {
    type: String,
    default: '200px',
  },
  maxWidth: {
    type: String,
    default: '',
  },
  maxHeight: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:modelValue', 'update:language']);
const internalCode = ref(props.modelValue);
const currentLanguage = ref(props.language);

// ----- 复制状态 -----
const snackbar = ref(false);

// ----- 引用 -----
const highlightRef = ref(null);
const textareaRef = ref(null);
const wrapperRef = ref(null);

// ----- 高亮渲染 -----
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
    warn('高亮失败，使用纯文本:', error);
    codeElement.textContent = code;
  }
};

// ----- 编辑同步 -----
const onInput = () => {
  emit('update:modelValue', internalCode.value);
  renderHighlight();
};

// ----- 滚动同步（使用 requestAnimationFrame 保证同步）-----
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

// ----- 复制功能（增强版）-----
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
    logError('复制失败:', err);
    alert('复制失败，请手动复制代码。\n错误信息：' + err.message);
  }
};

// ----- 自动补全括号/引号 -----
const handleKeydown = (event) => {
  const textarea = textareaRef.value;
  if (!textarea) return;

  const key = event.key;
  const pairs = {
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
      textarea.focus();
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
    textarea.focus();
  });
  emit('update:modelValue', newText);
  renderHighlight();
};

// ----- 监听外部语言变化 -----
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

// ----- 监听外部值 -----
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal !== internalCode.value) {
      internalCode.value = newVal;
      nextTick(renderHighlight);
    }
  }
);

// ----- 容器尺寸变化时重新同步滚动 -----
const resizeObserver = ref(null);
onMounted(() => {
  nextTick(() => {
    renderHighlight();
    syncScroll();
    if (textareaRef.value) {
      textareaRef.value.focus();
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
</script>

<style scoped>

.code-editor-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 300px;
  min-height: 200px;
}


.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px;
  background-color: var(--v-theme-surface, #f6f8fa);
  border: 1px solid var(--v-theme-border, #e1e4e8);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
}

.language-select {
  max-width: 160px;
  font-size: 13px;
}


.code-editor-wrapper {
  position: relative;
  border: 1px solid var(--v-theme-border, #e1e4e8);
  border-top: none;
  border-radius: 0 0 6px 6px;
  overflow: hidden;
  background-color: var(--v-theme-surface, #f6f8fa);
  flex: 1;
}


.highlight-layer,
.edit-layer {
  margin: 0;
  padding: 12px 16px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  font-size: 14px;
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
  min-height: 120px;


  vertical-align: baseline;
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
  padding: 12px 16px;
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
  vertical-align: baseline;
}


.edit-layer {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  background-color: transparent;
  color: transparent;
  padding: 12px 16px;
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