// SPDX-License-Identifier: MIT

// content（块存储坐标）↔ 视口屏幕坐标：屏幕位置 = content*zoom + origin + pan + 容器偏移，各处统一经此换算

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

// 亚像素会模糊，所以对齐到整数视觉像素（返回 content 值）
export const roundToVisual = (zoom: number, v: number): number => Math.round(v * zoom) / zoom

export const contentToScreen = (t: CanvasTransform, vp: ViewportOrigin, x: number, y: number): Point => ({
  x: x * t.zoom + t.origin.x + t.pan.x + vp.left,
  y: y * t.zoom + t.origin.y + t.pan.y + vp.top,
})

export const screenToContent = (t: CanvasTransform, vp: ViewportOrigin, clientX: number, clientY: number): Point => ({
  x: (clientX - vp.left - t.pan.x - t.origin.x) / t.zoom,
  y: (clientY - vp.top - t.pan.y - t.origin.y) / t.zoom,
})

// content → 视觉像素（.canvas 内定位用，不含容器偏移）
export const contentToVisual = (t: CanvasTransform, x: number, y: number): Point => ({
  x: Math.round(x * t.zoom) + Math.round(t.origin.x + t.pan.x),
  y: Math.round(y * t.zoom) + Math.round(t.origin.y + t.pan.y),
})
