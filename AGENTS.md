# AGENTS.md

本文件面向在此仓库工作的编码代理与新的贡献者，只写**本仓库特有的约定**，通用最佳实践不重复。

## 项目概览

Mindrizzle 是把笔记放上无限画布的桌面应用：内容以「块」的形式自由摆放，块内可嵌富文本或代码块，笔记以 `.mdrf` 归档存于本地。

- 前端：Vue 3 + TypeScript + Vite + Vuetify，包管理用 bun
- 编辑器：ProseKit / ProseMirror / KaTeX / highlight.js
- 桌面容器：Tauri 2；文件层：Rust（tar + flate2 + quick-xml）

## 常用命令

```bash
bun install
bun run dev                  # 只跑前端（浏览器 http://localhost:1420）
bun run tauri dev            # 起桌面应用
bunx tsc --noEmit            # 类型检查
bunx vite build              # 构建验证
cd src-tauri && cargo check  # Rust 侧编译检查
cd src-tauri && cargo test   # 含模块文档里的 no_run doctest
```

- `bun run build` 内置 `vue-tsc --noEmit`，会被既存类型错挡住；验证构建请直接 `bunx vite build`。
- 本机 bun 环境下 `vue-tsc` 报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，类型检查统一用 `bunx tsc --noEmit`。

## 注释规范（最高优先级）

注释只回答「为什么」，不回答「做什么」。代码本身能说明的地方不得有注释。

1. 只在必要时写注释，内容须是业务背景、第三方库行为或非常规处理。
2. 中文书写，禁止英文注释。
3. 禁止复读机注释：`getUser` 上方不得出现「获取用户」。
4. 禁止在简单赋值/调用后加尾随注释（如 `const max = 100 // 最大值`），原因写成上一行独立注释。
5. 复杂正则、位运算、坐标换算公式上方必须有一行中文说明意图。
6. 禁止 `// ====================` 之类装饰性分隔线；`// #region` / `// #endregion` 是编辑器折叠标记，**保留**。
7. 多行 why 注释要压到一行；只有真正复杂的坐标系/时序陷阱才允许两三行。
8.  删代码时同时删除其专属注释；改行为时同步更新相关 why 注释——注释说谎比没有注释更糟。

示例：

```ts
// 浏览器 BCR 是否含 zoom 不一致，所以用实测比例反推
domScale: blockRect.width / blockLayout.w

// 邻块会盖住块边缘内侧的缩放手柄，所以选中块 z 取 Z_LAYER.selectedBlock 提层
const SELECTED_Z_BASE = Z_LAYER.selectedBlock
```

## 代码规范

- 函数纯逻辑 ≤ 25 行，超出即拆；只服务当前父函数的子函数就近放置。
- 嵌套 `if/for/switch` ≤ 2 层，用早返回或 `continue` 拍平。
- 函数参数 ≤ 3 个，超出封装为对象。
- 命名：布尔以 `is/has/can/should` 开头；函数用「动词 + 名词」；变量禁用单字母（`i/j/e` 除外）与 `data`/`res`/`result` 之类占位词（作用域 ≤ 5 行除外）。
- 除 `0`/`1`/`-1`/`''` 外的魔法数字必须提为常量，常量名用大写下划线。
- 错误处理：只在调用边界（IPC 命令入口、事件入口、定时任务触发点）统一捕获；内部工具函数直接 `throw` 原生错误，不封装 `Result<T>` / `Either`。
- 资源配对：内存、文件句柄、监听器、rAF 与定时器必须在同一作用域内释放（`onUnmounted` 里成对 remove/cancel）。
- 安全：所有外部输入（IPC 参数、文件名、外部 `.mdrf`）在入口校验；Rust 侧 `resolve_mdrf_file_name` 与 `mdr_file_tar` 的路径穿越检查是既有防线，不要绕过。
- 日志：关键业务分支与异常捕获处用既有设施（Rust `log` 宏 / 前端 `@tauri-apps/plugin-log`）并带关键上下文；浏览器调试环境无 IPC，上报前用 `isTauri()` 守卫。
- 导入：分组为 标准库 → 第三方 → 项目内，组间一个空行；禁止通配符导入；改完立即删除未引用导入。

## 目录与职责

| 路径 | 职责 |
| --- | --- |
| `src/Controls/MdrCanvas.vue` | 画布核心：平移/缩放/框选/拖拽/联结/贴合遮罩/自动布局 |
| `src/Controls/ResizeBox.vue` | 单块容器与缩放手柄（手柄 Teleport 到 `.canvas` 顶层） |
| `src/Controls/RichEditor/` | 富文本编辑器、block-handle 扩展、插入组件节点视图 |
| `src/Controls/RichEditor/extensions/` | ProseKit 扩展与命中/坐标工具（坐标工具见 `blockHandleUtils.ts`） |
| `src/utils/canvasCoords.ts` | content ↔ 视口坐标换算的唯一来源 |
| `src/Controls/zIndex.ts` | 叠加层 z-index 的唯一事实来源 |
| `src/Views/Editor.vue` | 路由页面与工具栏交互（滚轮切工具、选区确认 overlay） |
| `src-tauri/src/mdr_file_*.rs` | `.mdrf` 归档读写、缓存目录、IPC 命令 |

## 硬约束

### 坐标系（最容易翻车处）

- 存在三套坐标：`content`（块存储坐标）、`layout`（`.canvas` 内 BCR 坐标，Chrome 下不含 zoom）、`viewport`（视觉坐标）。
- 换算只走 `utils/canvasCoords.ts` 与 `blockHandleUtils` 的 `layoutToViewportX/Y/Size`、`viewportToLayout`，**禁止手写公式**。
- 视口 → content 一律 `screenToContent`；布局 → 视口一律 `layoutToViewport*`。
- **`clientX/Y` 与 `getBoundingClientRect()` 不可直接比较**（BCR 是布局坐标、指针是视觉坐标）：命中判定必须把矩形经 `layoutToViewportX/Y` 换算到视觉空间（`barAt`、滚动条轨道翻页均已按此修）。凡是新增「按矩形判定指针」的代码，验证至少覆盖 zoom=0.5 一档。
- **禁用** `posAtCoords` / `coordsAtPos` / `posFromCaret`（内部拿 BCR 与鼠标坐标直接比较，zoom≠1 必错）。落点解析用 `elementFromPoint` → `.ProseMirror` 直系子块 → `posAtDOM`。
- `getCanvasScale` 的入参既可为 view 也可为元素；只认 view 会让传元素的调用静默拿到 1。
- 画布 pan/zoom 落定后必须 `invalidateCanvasScaleCache()`。

### 事件与监听

- 与指针拖拽相关的 window 监听必须用**捕获阶段**（`addEventListener(..., true)`），移除时同参。原因：`useHoverState` 会在 window 捕获阶段 `stopPropagation`。
- 伪指针事件必须过滤：`if (!e.isTrusted) return`；`-9999` 坐标是 `hideAllBlockHandles` 的清 hover 信号。
- 高频指针回调禁止 `document.elementFromPoint`（每块 × 每事件的强制布局），改用 `event.target` + `dom.contains`。
- 高频路径用 rAF 合并，既有约定（`panRafId` / `customDragRafId` / `geometryRafId` / `scheduleScrollMetrics`）勿改成逐事件处理。

### 画布与叠层

- `.canvas` 用 CSS `zoom` 缩放；**禁止给块加 `translate3d`**（位图纹理放大会让文字发虚），用普通 `translate`。
- `.canvas-container` 必须 `overflow: clip`（保留 `overflow: hidden` 作旧引擎回退）：`hidden` 下 ProseMirror 的 `scrollIntoView` 会改写 `scrollLeft/Top`，导致点阵露白与坐标偏移。
- 叠加层 z-index 全部登记在 `src/Controls/zIndex.ts`；TS 常量与 CSS 硬编码值必须一致，改一处要同步另一处。
- block-handle popup 的 `Root` 必须 Teleport 到 `.canvas`（**不是** `.canvas-container`），否则 store context 会丢、reference 与定位不处于同一布局坐标空间。
- 贴合遮罩、圆角、曲别针候选都是 `layout` 推导的 O(N²) 结果，统一由 `recomputeMasks()` 刷新；交互期间冻结，收尾再刷新。增删块、布局落定后不要忘记调用。
- 浮层渲染走小集合（`floatingOwnerId` / `sideSettingsItem` / `selectedOutlineItems`），禁止整表 `v-for` + 逐块 `v-if`。
- 视口外的块会被虚拟化（`MdrCanvas` 的 `virtualSnapshots` / `reconcileVirtualBlocks`）：实例被销毁、只留静态快照，故 `componentRefs[id]` 只保证「可见 ∪ 选中 ∪ 拖拽/resize/popup ∪ 焦点所在」的块存在——跨层批量操作不得假设所有块都有活实例。
- 命中测试禁止逐 mousemove 读 DOM 矩形，用 `screenRectFactory()` 按公式计算；几何常量必须与 `ResizeBox.vue` 的 `HANDLE_POS` / `HANDLE_SIZE` / 手柄样式同步。
- 命中测试先取 `selectedBlockItems()`（选中块小集合），不要遍历 `state.items` 再逐个过滤——后者让每次 pointermove 随块数线性劣化。
- `.drag-wrapper` 只允许 `contain: layout style`。**禁止加 `paint`**（会裁掉 RichTextEditor 用负边距外扩 64/80px 的 gutter）；**禁止加 `content-visibility`**（视口外块被跳过布局会让块内 RO 报 0，`onAutoHeight` 随即把块高压到 minH）。
- rAF 热路径内同一目标块的测量必须走帧号缓存（`richTextTargetForFrame` / `isTargetVisibleForFrame`，帧号取 rAF 回调 timestamp、同帧一致；帧号 0 表示帧外直测，勿缓存）。

### ProseMirror / ProseKit

- `editor.view` 只能在 `editor.mount()` 之后访问；在 setup 或 `watch(..., { immediate: true })` 里访问会抛错并中断整棵组件树（表现为「所有添加块失效」）。
- `editor.mount(el)` 把 ProseMirror 挂在 `.editor-mount` 同一元素上，因此 `.editor-mount :deep(.ProseMirror)` 这类后代选择器**恒不命中**，统一写 `.editor-mount.ProseMirror`。
- block-handle 的 store 必须从 positioner 自身派发 `aria-ui:context-request` 解析（positioner 已 Teleport 出 wrapper）。
- `.forced-open` / `.popup-keep` 只写 `display` / `visibility` 的 `!important`，不要一起写 `opacity`/`scale`，否则会盖掉 `@starting-style` 入场动画。
- 缩放环境下的 hover 由 `useHoverState` 自解析并经 `store.hoverState.set()` 独占，同时用合成 `pointermove` 让 ProseKit 的定位自洽；两者缺一都会出现「popup 不出现」或「拖拽源为空」。

### 交互语义

- 选中与聚焦只由点击/框选决定，悬停只切换浮层归属（`hoveredBlockId`），不要随手改选中或抢焦点。
- 移动端锁水平（`x` 恒 0、宽贴画布）并纵向堆叠；桌面端按视口宽瀑布流平铺。改动布局后同步 `arranged` 与移动端堆叠平移。
- 「拖组件入富文本块」时，块完全可见则只滚块内内容，块未完全显示才平移画布（commit 767ea68 的既有规则，**不要**改成画布优先）。
- `useBlockDrag` 的段落拖拽路径不要改：块内滚动与画布平移并存是既定行为。
- 拖拽/框选松手后浏览器会补发 `click`，用 `dragJustFinished` / `justFinishedSelection` 吞掉，避免拖拽结果被点击语义覆盖。

## 构建与调试环境

- bun 的依赖经 `~/.bun/install/cache` 符号链接暴露，realpath 落在 workspace 外；`vite.config.ts` 的 `server.fs.allow` 必须包含该目录（并带上 `'.'`）。
- 依赖树里 `prosemirror-view` 曾被解析出两份（1.42.1/1.42.3），prosekit 的 `pm/view` 与 `pm/state` 各用一份，会让 `EditorView` 类型互不兼容；`package.json` 的 `overrides` 已锁死 1.42.3，勿删。
- `bun.lock` 一旦与 `package.json` 不同步，`bun install` 会重解析整棵树（曾一次改动 261 条解析），故改依赖后要确认 diff 范围。
- 路由用 `createMemoryHistory`，浏览器里改 URL 不会切页；验证页面需点击导航。
- 编辑器链路（ProseKit + highlight.js + KaTeX）保持懒加载：新增路由沿用 `() => import()`，新增重型依赖同步 `canvasComponents.ts` 的 `defineAsyncComponent`。
- `optimizeDeps.entries` 已覆盖 `index.html` 与 `src/**/*.{vue,ts}`，勿删；否则 dev 首次进 `/editor` 会触发依赖重优化整页 reload。
- 模板里自动导入的 Vuetify 组件扫不到，dev 首次进入某懒加载页面仍会有一次 optimize + reload，属正常现象。

## 验证清单

1. `bunx tsc --noEmit`：应零报错。
2. 改动画布/编辑器交互后，用内置浏览器实操一遍：拖块、拖组件入富文本、缩放手柄、框选、右键平移、切换缩放（0.5 / 1 / 2 / 3）、切移动端模拟。
3. 改动 Rust 侧跑 `cargo check`；改动打包逻辑跑 `cargo test`（`mdr_file_tar` / `mdr_file_cache` 的模块文档里有 `no_run` doctest，精简文档时不要删掉示例代码块）。
4. 浏览器自动化注意：`page.mouse` 在此内置浏览器里坐标不可靠（事件根本送不进页面），用 `elementFromPoint` / `dispatchEvent` 合成事件；`onCustomDragMove` 有 `isTrusted` 过滤，**块拖拽无法用合成事件验证**（框选/缩放/选中可以）。更关键：该页面里 **rAF 与 ResizeObserver 完全不派发**（`visibilityState` 仍为 `visible`），凡依赖 rAF/RO 的行为（滚动条补测、autoHeight 报高、Vue transition）都观测不到，**别把它当成 bug**——只能用同步路径或 `getBoundingClientRect` 强制布局验证。
5. 缩放相关验证需等 vite 依赖优化完成后再交互，否则整页 reload 会丢掉状态。
