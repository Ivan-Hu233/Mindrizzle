// ==================== 组件尺寸约束（共享类型与工具）====================

/**
 * 组件的尺寸约束（单位：px）。
 * - 数字：具体的最小/最大尺寸
 * - null：表示无限制（例如 maxWidth: null 表示宽度不限）
 * - undefined：未声明，会回退到 {@link DEFAULT_CONSTRAINTS}
 *
 * 组件应在普通 `<script>` 块中通过命名导出 `resizeConstraints` 声明自身约束：
 * ```ts
 * export const resizeConstraints: ResizeConstraints = {
 *   minWidth: 330,
 *   maxWidth: null,
 *   minHeight: 210,
 *   maxHeight: null,
 * }
 * ```
 * 调用方（如 `vue-component.ts` / `Editor.vue`）统一通过该导出获取组件的最大/最小尺寸。
 */
export type ResizeConstraints = {
  minWidth?: number | null
  maxWidth?: number | null
  minHeight?: number | null
  maxHeight?: number | null
}

/** 默认约束（当组件未显式声明时使用） */
export const DEFAULT_CONSTRAINTS: Required<ResizeConstraints> = {
  minWidth: 100,
  maxWidth: 800,
  minHeight: 80,
  maxHeight: 600,
}

/**
 * 规范化约束：把可选字段补全为 `Required<ResizeConstraints>`。
 * - undefined → 使用 {@link DEFAULT_CONSTRAINTS}
 * - null → 保留（表示无限制）
 */
export function normalizeConstraints(
  raw: ResizeConstraints | null | undefined
): Required<ResizeConstraints> {
  const source = raw ?? {}
  return {
    minWidth:
      source.minWidth === undefined ? DEFAULT_CONSTRAINTS.minWidth : source.minWidth,
    maxWidth:
      source.maxWidth === undefined ? DEFAULT_CONSTRAINTS.maxWidth : source.maxWidth,
    minHeight:
      source.minHeight === undefined ? DEFAULT_CONSTRAINTS.minHeight : source.minHeight,
    maxHeight:
      source.maxHeight === undefined ? DEFAULT_CONSTRAINTS.maxHeight : source.maxHeight,
  }
}
