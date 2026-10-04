<!-- 最后验证: 2026-10-4 -->
# 08 序列化与兼容

## 图 8.1 save 数据流

```mermaid
flowchart TD
  A["save()"] --> B["syncComponentData 拉取各组件 saveConfig"]
  B --> C["计算块群包围盒中心 cx, cy"]
  C --> D["toSaveRect 相对 origin + pan - 中心"]
  D --> E["序列化 items（桌面 + 移动）"]
  E --> F["序列化 origin + links"]
  F --> G["返回 JSON 字符串"]
```

## 图 8.2 load 数据流

```mermaid
flowchart TD
  A["load(raw)"] --> B["JSON.parse"]
  B --> C{"格式？"}
  C -->|数组| D["state.items = map(normalizeLoadedItem)"]
  C -->|含 items| E["读取 origin + items"]
  E --> F["map(normalizeLoadedItem)"]
  D --> G["pan = 0"]
  F --> G
  G --> H["清 virtualSnapshots / virtualScrolls"]
  H --> I["reconcileVirtualBlocks 首次定虚拟集"]
  I --> J["linkedPairs 恢复"]
  J --> K["nextTick × 2"]
  K --> L{"mobileMode?"}
  L -->|是| M["origin.x 并入 desktop.x<br/>applyMobileLayout"]
  L -->|否| N["跳过"]
  M --> O["autoArrange"]
  N --> O
  O --> P["reconcileVirtualBlocks 二次定虚拟集"]
  P --> Q["loadConfig 各组件"]
  Q --> R["recomputeMasks"]
```

## 图 8.3 normalizeLoadedItem 兼容分支

```mermaid
flowchart TD
  A["normalizeLoadedItem(it)"] --> B["component 未知则回落 RichTextEditor"]
  B --> C{"isLegacyFlat?"}
  C -->|是| D["从 it.x/y/w/h 构造 desktop"]
  C -->|否| E["用 it.layout.desktop + 默认兜底"]
  D --> F["mobile = desktop + it.layout.mobile 覆盖"]
  E --> F
  F --> G["坐标类型兜底归 0"]
  G --> H{"it.arranged 存在？"}
  H -->|是| I["读取 arranged"]
  H -->|否| J["desktop 视为已排<br/>mobile 与 desktop 一致则未排"]
  I --> K["markRaw 返回"]
  J --> K
```

## 兼容规则速查

- 旧扁平格式（`it.x/y/w/h`）→ 转为 `layout.desktop`
- `origin` 坐标归一化：保存时减去块群中心，加载时归零 pan
- 移动端宽度运行时拉伸，不持久化
- `arranged` 缺失时：desktop 视为已排，mobile 若与 desktop 一致则视为未排

## 维护提示

- 新增字段 → 更新图 8.1、8.3
- 改兼容规则 → 更新图 8.3 + 加测试