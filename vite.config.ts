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
