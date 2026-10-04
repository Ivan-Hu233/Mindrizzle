# MdrCanvas 文档

## 怎么读

1. 先读 [00-architecture](00-architecture.md) 建立全景
2. 再读 [01-coordinates](01-coordinates.md) 理解坐标系（最关键）
3. 再读 [02-contracts](02-contracts.md) 记住接口契约
4. 遇到具体问题按场景跳转：
   - 拖拽/缩放 → [04-drag-resize](04-drag-resize.md)
   - 手柄/popup → [06-block-handle](06-block-handle.md)
   - 卡顿 → [09-perf](09-perf.md)
   - 诡异行为 → [11-workarounds](11-workarounds.md)

## 文件索引

| 文件 | 关注点 |
|---|---|
| 00-architecture.md | 全景与依赖 |
| 01-coordinates.md | 坐标系换算 |
| 02-contracts.md | 事件 + DOM 契约 |
| 03-sessions.md | 交互会话状态机 |
| 04-drag-resize.md | 拖拽与缩放主流程 |
| 05-block-lifecycle.md | 块挂载/虚拟化/高度 |
| 06-block-handle.md | 悬浮手柄与 popup |
| 07-events-flow.md | 事件连锁反应 |
| 08-save-load.md | 序列化与兼容 |
| 09-perf.md | 节流与缓存 |
| 10-utils.md | 工具函数索引 |
| 11-workarounds.md | 非逻辑防御清单 |

## 维护规则

- 每次结构性改动（新增会话、事件、选择器、坐标系）必须更新对应文档
- 函数内部改 bug 不必更新
- 每个文件保留最后验证日期，结构性改动后同步刷新该信息