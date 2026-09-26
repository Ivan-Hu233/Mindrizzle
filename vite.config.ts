import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

// @ts-expect-error process is a nodejs global
const { TAURI_DEV_HOST: host, HOME: homeDir } = process.env;

// 因 bun 的依赖是经 ~/.bun/install/cache 的符号链接暴露的，realpath 后落在 workspace 之外，
// 故必须显式放行该缓存目录，否则 Vite 的 fs 守门会拒绝加载 Vuetify 等依赖的样式
const bunCacheDir = homeDir ? `${homeDir}/.bun/install/cache` : undefined;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(),vuetify()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    // 因 Tauri 各平台 WebView 均为现代内核，无需为旧浏览器降级转译
    target: 'esnext',
  },
  // 因路由已改为懒加载，默认只扫 index.html 的入口图不再覆盖各页面链路的依赖，
  // 故显式扫描全部源码，否则首次进入 /editor 会触发依赖重优化并整页重载
  optimizeDeps: {
    entries: ["index.html", "src/**/*.{vue,ts}"],
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    fs: {
      allow: [".", ...(bunCacheDir ? [bunCacheDir] : [])],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
