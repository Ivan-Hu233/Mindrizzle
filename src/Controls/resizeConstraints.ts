/** 组件尺寸约束（px）：数字 = 具体尺寸，null = 无限制，undefined = 回退 {@link DEFAULT_CONSTRAINTS}。
 *  组件须在普通 <script> 块中命名导出 resizeConstraints 声明自身约束 */
export type ResizeConstraints = {
  minWidth?: number | null
  maxWidth?: number | null
  minHeight?: number | null
  maxHeight?: number | null
}

/** 组件未声明时使用的默认约束 */
export const DEFAULT_CONSTRAINTS: Required<ResizeConstraints> = {
  minWidth: 100,
  maxWidth: 800,
  minHeight: 80,
  maxHeight: 600,
}

/** 把可选字段补全为 Required：undefined → DEFAULT_CONSTRAINTS，null → 保留（无限制） */
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
