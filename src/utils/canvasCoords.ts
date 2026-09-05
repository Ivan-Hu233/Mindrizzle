// SPDX-License-Identifier: MIT

// 画布坐标换算集中于此：content（块存储坐标）↔ 视口屏幕坐标。
// 屏幕位置 = content*zoom + origin + pan + 容器视口偏移，
// 各处统一经此换算，避免手写公式不一致（原点重定位/平移/缩放只改 transform）

export interface CanvasTransform {
  zoom: number
  origin: { x: number; y: number }
  pan: { x: number; y: number }
}

export interface ViewportOrigin {
  left: number
  top: number
}

export interface Point {
  x: number
  y: number
}

// content 坐标经 zoom 缩放落亚像素会模糊，对齐到整数视觉像素（返回 content 值）
export const roundToVisual = (zoom: number, v: number): number => Math.round(v * zoom) / zoom

// content → 视口屏幕（含容器偏移，供 hitTest/几何判断）
export const contentToScreen = (t: CanvasTransform, vp: ViewportOrigin, x: number, y: number): Point => ({
  x: x * t.zoom + t.origin.x + t.pan.x + vp.left,
  y: y * t.zoom + t.origin.y + t.pan.y + vp.top,
})

// 视口屏幕 → content（供鼠标位置换算）
export const screenToContent = (t: CanvasTransform, vp: ViewportOrigin, clientX: number, clientY: number): Point => ({
  x: (clientX - vp.left - t.pan.x - t.origin.x) / t.zoom,
  y: (clientY - vp.top - t.pan.y - t.origin.y) / t.zoom,
})

// content → 视觉像素（.canvas 内定位用，不含容器偏移；origin+pan 为视口像素直接累加）
export const contentToVisual = (t: CanvasTransform, x: number, y: number): Point => ({
  x: Math.round(x * t.zoom) + Math.round(t.origin.x + t.pan.x),
  y: Math.round(y * t.zoom) + Math.round(t.origin.y + t.pan.y),
})
