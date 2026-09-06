<div align="center">

# Mindrizzle

**Catch your mind drizzle.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app/)
[![Vue](https://img.shields.io/badge/Vue-3-42B883.svg)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-000000.svg)](https://bun.sh/)
[![Version](https://img.shields.io/badge/version-0.1.0-orange.svg)](package.json)
[![Top Language](https://img.shields.io/github/languages/top/Ivan-Hu233/Mindrizzle.svg)](https://github.com/Ivan-Hu233/Mindrizzle)
[![GitHub Stars](https://img.shields.io/github/stars/Ivan-Hu233/Mindrizzle.svg?style=flat)](https://github.com/Ivan-Hu233/Mindrizzle/stargazers)
[![Commit Activity](https://img.shields.io/github/commit-activity/y/Ivan-Hu233/Mindrizzle.svg)](https://github.com/Ivan-Hu233/Mindrizzle/commits/main/)
[![Visitors](https://komarev.com/ghpvc/?username=Ivan-Hu233&repo=Mindrizzle&label=visitors&color=blue)](https://github.com/Ivan-Hu233/Mindrizzle)

</div>

Mindrizzle 是一个把笔记放上画布的桌面应用。

普通编辑器擅长让文字排成一列，Mindrizzle 更在意另一件事：让想法拥有自己的位置。你可以在同一张画布上摆放富文本、代码块和正在发芽的灵感，再慢慢把它们整理成一组真正属于自己的笔记。

项目目前处于早期开发阶段，界面和文件格式都还在持续打磨中。欢迎把它当作一个可以一起成长的实验场。

## 现在能做什么

- **画布式笔记**：在可缩放、可移动的画布上组织内容块。
- **富文本块**：支持标题、加粗、斜体、下划线等基础格式，并提供块级操作。
- **代码块**：编辑代码、切换语言、语法高亮，一键复制；覆盖 JavaScript、TypeScript、Python、Rust、Vue 等常用语言。
- **便签集与记事板**：从不同视角浏览和管理笔记。
- **本地优先**：笔记保存为 `.mdrf` 文件，由 Rust 侧负责读写、缓存和打包，不依赖云端账号。
- **桌面体验**：使用 Tauri 打包，支持窗口控制、主题切换和开发调试页面。


## 技术栈

- **前端**：Vue 3、TypeScript、Vite、Vuetify
- **编辑器**：ProseKit、ProseMirror、KaTeX、DOMPurify
- **桌面容器**：Tauri 2
- **后端与文件层**：Rust、Tokio、quick-xml、tar、flate2
- **代码高亮**：highlight.js

## 开始开发

### 环境要求

- Bun
- Rust 工具链
- Tauri 2 的系统依赖

Tauri 的系统依赖会因 Linux 发行版而不同，详情请参考 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

### 安装并启动前端

```bash
bun install
bun run dev
```

### 启动桌面应用

```bash
bun run tauri dev
```

### 构建前端

```bash
bun run build
```

这个命令会先运行 `vue-tsc` 类型检查，再执行 Vite 构建。

## 项目结构

```text
src/
├── Controls/              # 画布、对话框、富文本和代码块
├── Views/                 # 编辑器、便签集、记事板、设置
├── utils/                 # 坐标换算与 Tauri 调用封装
└── App.vue                # 应用外壳与主导航

src-tauri/src/
├── mdr_file_*.rs          # .mdrf 文件、缓存、目录与归档操作
└── main.rs / lib.rs       # Tauri 应用入口
```

## 文件格式

Mindrizzle 使用自有的 `.mdrf` 笔记文件。文件由元信息和正文组成，Rust 侧会在保存时进行缓存与原子替换，减少写入失败造成文件损坏的风险。

这意味着笔记属于你自己：可以保存、复制和管理文件，而不是把内容锁在某个服务里。

## 参与开发

如果你发现了问题，或对“笔记应该怎样摆放”有自己的答案，欢迎提交 Issue 或 Pull Request。提交代码前建议先运行：

```bash
bun run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)。

<h2 align="center">贡献者</h2>

<p align="center">
	<a href="https://github.com/Ivan-Hu233/Mindrizzle/graphs/contributors">
		<img src="https://contrib.rocks/image?repo=Ivan-Hu233/Mindrizzle" alt="Mindrizzle contributors" />
	</a>
</p>

<p align="center">
	<a href="https://github.com/Ivan-Hu233/Mindrizzle">
		&#9733; 给 Mindrizzle 点个 Star
	</a>
</p>
