<template>
  <v-sheet class="canvas-container" :ref="setCanvasContainerRef" :style="containerStyle" @click="handleCanvasClick"
    @mousedown="onCanvasMouseDown" @mousemove="onCanvasMousemove" @focusin="handleCanvasFocusin">
    <!-- 因点阵背景随 pan 平移若用 background-position 会每帧重绘整容器（大视口下卡顿），故独立成层用 transform 合成移动 -->
    <div class="canvas-dots" :style="dotsStyle" aria-hidden="true" />
    <!-- 因 .canvas 随 pan 平移后不覆盖整个容器，事件挂容器级才能让任意空白处框选/点击/聚焦生效 -->
    <div class="canvas" :class="{ panning: isPanning }" :style="canvasStyle" ref="canvasRef">
      <ResizeBox v-for="item in state.items" :key="`${item.id}-${mobileMode ? 'm' : 'd'}`"
        :data-id="item.id" :z-index="blockZ(item.id)" :active="isActive(item.id)" :x="layoutOf(item).x"
        :y="layoutOf(item).y" :w="layoutOf(item).w" :h="layoutOf(item).h"
        :min-width="(constraintsOf(item).minWidth ?? 0) + 8" :min-height="(constraintsOf(item).minHeight ?? 0) + 8"
        :max-width="constraintsOf(item).maxWidth ?? null" :max-height="constraintsOf(item).maxHeight ?? null"
        :handles="resizeHandlesOf(item)" :disabled="!isEditMode" :zoom="zoom"
        @resizestart="(handle: string) => onResizeStart(item, handle)"
        @resizing="(x, y, w, h) => onResizing(item, x, y, w, h)" @resizestop="(x, y, w, h) => onResizeStop(item, x, y, w, h)" class="drag-wrapper"
        :class="{ selected: isEditMode && state.selectedIds.has(item.id), 'popup-open': popupBlockId === item.id }">
        <div class="block-container bg-surface elevation-1 rounded">
          <div class="content-area">
            <component :is="componentMap[item.component as keyof typeof componentMap]"
              :ref="(el) => setComponentRef(item.id, el)" v-bind="getComponentProps(item)"
              @update:model-value="(val: string) => updateCode(item.id, val)"
              @update:language="(lang: string) => updateLanguage(item.id, lang)" class="inner-component" />
          </div>
        </div>
      </ResizeBox>

      <v-fade-transition :duration="120">
        <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle"></div>
      </v-fade-transition>
      <template v-for="item in state.items" :key="`handle-${item.id}`">
        <Transition name="pop-up">
          <div v-if="isEditMode && state.selectedIds.has(item.id)" class="floating-handle drag-handle"
            :class="{ 'handle-bottom': handlePlacementOf(item) === 'bottom' }"
            :data-id="item.id" :style="handleBarStyle(item)"
            @mousedown="(e: MouseEvent) => startCustomDrag(item, e)">
            <v-icon size="16" color="on-surface-variant" :icon="mdiDragVariant" class="mr-1" />
            <span class="text-caption text-medium-emphasis user-select-none">
              {{ componentLabelOf(item.component) }}
            </span>
          </div>
        </Transition>
      </template>

      <!-- 因富文本块级设置（高度自适应）需独立于内容区，故在块右侧单开一栏放齿轮按钮 -->
      <template v-for="item in state.items" :key="`side-${item.id}`">
        <Transition name="pop-up">
          <div v-if="isEditMode && state.selectedIds.has(item.id) && item.component === 'RichTextEditor'"
            class="side-settings" :class="{ 'handle-bottom': handlePlacementOf(item) === 'bottom' }"
            :data-id="item.id" :style="sideSettingsStyle(item)">
            <v-menu location="bottom end" :close-on-content-click="false" :close-on-back="false">
              <template #activator="{ props: menuProps }">
                <v-btn v-bind="menuProps" size="x-small" variant="tonal" color="grey" icon
                  title="块设置" @mousedown.stop @click.stop>
                  <v-icon :icon="mdiCogOutline" size="13" />
                </v-btn>
              </template>
              <v-card min-width="240" class="auto-height-menu">
                <v-list density="compact">
                  <v-list-item>
                    <v-switch :model-value="isAutoHeight(item)" color="primary"
                      label="高度自适应内容" hint="块高随内容自动调整" persistent-hint hide-details
                      @update:model-value="(v: unknown) => setAutoHeight(item, !!v)" />
                  </v-list-item>
                </v-list>
              </v-card>
            </v-menu>
          </div>
        </Transition>
      </template>

      <!-- 因选中描边环需绘制在拖拽栏之上（描边连贯不被 handle 遮断），
           故用独立高层 overlay 渲染描边，块自身不再用 box-shadow -->
      <template v-for="item in state.items" :key="`outline-${item.id}`">
        <v-fade-transition :duration="120">
          <div v-if="isEditMode && state.selectedIds.has(item.id)" class="selected-outline"
            :style="selectedOutlineStyle(item)" />
        </v-fade-transition>
      </template>

      <template v-for="p in paperclips" :key="`clip-${p.a}-${p.b}`">
        <div class="snap-paperclip" :class="{ linked: p.linked }"
          :style="{ left: `${roundToPx(p.x)}px`, top: `${roundToPx(p.y)}px` }"
          :title="p.linked ? '点击分离' : '点击粘贴'"
          @mousedown.stop @click.stop="toggleLink(p.a, p.b)">
          <v-icon size="16" :icon="mdiPaperclip" />
        </div>
      </template>
    </div>
  </v-sheet>
</template>

<script lang="ts">
import type { NodeJSON } from '@prosekit/core'
import type { EditorCommands } from './BaseIrEditor/extension'

// 因这些类型需在普通 <script> 中导出供父组件复用，故置于此处
export interface RichTextConfig {
  content: NodeJSON | null
  // 因块高是否随内容自适应由富文本设置栏控制，故持久化于 config
  autoHeight?: boolean
}

export interface CodeBlockConfig {
  code: string
  language: string
}

export type WidgetConfig = RichTextConfig | CodeBlockConfig

export interface ComponentController {
  saveConfig?: () => Partial<WidgetConfig>
  loadConfig?: (config: WidgetConfig) => void
  // 因父组件需经命令链调用富文本命令（如 toggleHeading）且要 IDE 补全，故用 editor.commands 推导的精确类型而非宽泛索引签名
  commands?: EditorCommands
}
</script>

<script setup lang="ts">
import { reactive, ref, nextTick, onMounted, onUnmounted, computed, watch, type CSSProperties } from 'vue'
import ResizeBox from './ResizeBox.vue'

import { mdiDragVariant, mdiPaperclip, mdiCogOutline } from '@mdi/js'
import RichTextEditor, { resizeConstraints as richTextConstraints } from '../Controls/BaseIrEditor/RichTextEditor.vue'
import EditableCodeBlock, { resizeConstraints as codeBlockConstraints } from '../Controls/EditorPlugin/EditableCodeBlock.vue'
import { normalizeConstraints, type ResizeConstraints } from '../Controls/resizeConstraints'
import { Z_LAYER } from './zIndex'

import { useDisplay } from 'vuetify'

const { xs } = useDisplay()
const isMobile = computed(() => xs.value)

// 因 forceMobile 为调试用的三态开关，故 null 表示不强制、走真实断点
const forceMobile = ref<boolean | null>(null)
const mobileMode = computed(() => (forceMobile.value === null ? isMobile.value : forceMobile.value))

const nextForceMobile = (): boolean | null => {
  if (forceMobile.value === null) return true
  if (forceMobile.value === true) return false
  return null
}

const isEditMode = ref(true)

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface CanvasItem {
  id: string
  component: 'RichTextEditor' | 'EditableCodeBlock'
  config: WidgetConfig
  layout: {
    desktop: Rect
    mobile: Rect
  }
  // 标记各端布局是否已排好；false 的端在首次进入时自动布局，之后保持用户手动调整
  arranged: {
    desktop: boolean
    mobile: boolean
  }
}

const componentMap = {
  RichTextEditor,
  EditableCodeBlock,
}

// 因新增可添加组件只需在此注册（key 对应 componentMap 的键）即可自动驱动工具栏与添加逻辑，故集中于此
interface AddableComponentMeta {
  key: CanvasItem['component']
  label: string
  addId: string
  defaultConfig: () => WidgetConfig
  defaultSize: { w: number; h: number }
}

const ADDABLE_COMPONENTS: AddableComponentMeta[] = [
  {
    key: 'RichTextEditor',
    label: '富文本',
    addId: 'add-rich',
    defaultConfig: () => ({ content: null }),
    defaultSize: { w: 400, h: 300 },
  },
  {
    key: 'EditableCodeBlock',
    label: '代码块',
    addId: 'add-code',
    defaultConfig: () => ({
      code: '// 在此编写代码',
      language: 'javascript',
    }),
    defaultSize: { w: 400, h: 250 },
  },
]

const componentMetaOf = (key: CanvasItem['component']) =>
  ADDABLE_COMPONENTS.find((c) => c.key === key)

const componentLabelOf = (key: CanvasItem['component']) =>
  componentMetaOf(key)?.label ?? key

// 因组件未声明 resizeConstraints 时需回退画布默认（min 100，宽高不限），故统一经 normalizeConstraints 归一
const componentConstraints: Partial<
  Record<CanvasItem['component'], ResizeConstraints>
> = {
  RichTextEditor: richTextConstraints,
  EditableCodeBlock: codeBlockConstraints,
}

const CANVAS_DEFAULT_CONSTRAINTS: Required<ResizeConstraints> = {
  minWidth: 100,
  maxWidth: null,
  minHeight: 100,
  maxHeight: null,
}

const constraintsOf = (item: CanvasItem): Required<ResizeConstraints> => {
  const raw = componentConstraints[item.component]
  if (!raw) return CANVAS_DEFAULT_CONSTRAINTS
  return normalizeConstraints(raw)
}

const state = reactive({
  items: [] as CanvasItem[],
  selectedIds: new Set<string>(),
})

// 因内容聚焦时需把该块提到最上层（显示在最前），故用 zMap 维护自增计数；
// 因叠加层 z 固定（见 zIndex.ts 的 Z_LAYER），若 zCounter 无限递增超过其值，
// 普通块会盖住叠加层，故达阈值时按当前顺序重排为 1..N 防止计数溢出
const zMap = reactive<Record<string, number>>({})
let zCounter = 0
const Z_LIMIT = Z_LAYER.itemZLimit
const itemZ = (id: string): number => zMap[id] ?? 0
const normalizeZMap = () => {
  const ids = Object.keys(zMap).sort((a, b) => zMap[a] - zMap[b])
  ids.forEach((id, i) => { zMap[id] = i + 1 })
  zCounter = ids.length
}
const bringToTop = (id: string) => {
  if (zMap[id] === zCounter && zCounter > 0) return // 已是最上层，避免计数器膨胀
  zMap[id] = ++zCounter
  if (zCounter >= Z_LIMIT) normalizeZMap()
}

// 因缩放手柄渲染在块边缘内侧，紧贴的邻块（同 z 层级、DOM 靠后）会盖住手柄导致点不到，
// 故选中块 z 提升到高于所有普通块（VDR 的 activeOnTop 同款行为）；
// 且需高于描边环使块内 popup 对外层级也在描边环之上，故基值取 Z_LAYER.selectedBlock
const SELECTED_Z_BASE = Z_LAYER.selectedBlock
const blockZ = (id: string): number =>
  isEditMode.value && state.selectedIds.has(id) ? Math.max(itemZ(id), SELECTED_Z_BASE) : itemZ(id)

// 因 ResizeBox 的 active 属性会驱动缩放手柄显示，故选中块时置为激活
const isActive = (id: string): boolean => isEditMode.value && state.selectedIds.has(id)

const componentRefs = ref<Record<string, ComponentController | undefined>>({})
const canvasRef = ref<HTMLElement | null>(null)
const canvasContainerRef = ref<HTMLElement | null>(null)

// 因 Vuetify 组件上绑定 ref 拿到的是组件实例而非 DOM 元素，故经 $el 取出根 DOM 以调用 DOM API
const setCanvasContainerRef = (el: unknown) => {
  canvasContainerRef.value = (el as { $el?: HTMLElement } | null)?.$el ?? (el as HTMLElement | null)
}
const canvasWidth = ref(0)

// 因块以世界坐标自由放置（VDR 无 parent 不受边界约束）且平移无界，
// 故点阵背景固定在视口容器上以保证任何位置不露白
const pan = reactive({ x: 0, y: 0 })
const isPanning = ref(false)

// 因块坐标无限增长会导致数据溢出，故坐标过大时重定位画布原点
// （块坐标整体平移并入 origin，屏幕位置 = 存储坐标 + origin + pan 不变）
const origin = reactive({ x: 0, y: 0 })

const rebaseOrigin = (offset: { x: number; y: number }) => {
  const dx = Math.round(offset.x) || 0
  const dy = Math.round(offset.y) || 0
  if (!dx && !dy) return
  // 因移动端锁水平（块 x 恒 0）、水平原点不参与，故仅竖直重定位，
  // 且 desktop/mobile 竖直同步平移，保证切换模式后位置一致
  const effDx = mobileMode.value ? 0 : dx
  state.items.forEach((item) => {
    item.layout.desktop.x -= effDx
    item.layout.desktop.y -= dy
    item.layout.mobile.y -= dy
  })
  origin.x += effDx
  origin.y += dy
}

const ORIGIN_REBASE_THRESHOLD = 1_000_000
const maybeRebaseOrigin = () => {
  if (state.items.length === 0) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  state.items.forEach((it) => {
    const l = it.layout.desktop
    if (l.x < minX) minX = l.x
    if (l.y < minY) minY = l.y
    if (l.x > maxX) maxX = l.x
    if (l.y > maxY) maxY = l.y
  })
  const maxAbs = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY))
  if (maxAbs <= ORIGIN_REBASE_THRESHOLD) return
  rebaseOrigin({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 })
}

const panSession = reactive({
  active: false,
  startClientX: 0,
  startClientY: 0,
  startPanX: 0,
  startPanY: 0,
})

// 因需等比例缩放画布（视觉缩放、交互坐标按 /zoom 换算），故 zoom 状态供 canvas 变换与各交互换算共用
const zoom = ref(1)
// 因 .canvas 被 scale(zoom)，content 坐标乘 zoom 落亚像素会致边缘/内容模糊，渲染层统一圆整到整数视觉像素
const roundToPx = (v: number) => Math.round(v * zoom.value) / zoom.value
const visualY = (v: number) => Math.round(v * zoom.value) + Math.round(pan.y + origin.y)

// 因浏览器对 transform scale 的合成层按旧 scale 光栅化纹理、放大后显示旧纹理会模糊
// （交互/内容变化才触发重新光栅化），故 zoom 变化后先销毁再重建 .canvas 合成层强制按新比例光栅化
const forceRecomposite = () => {
  const el = canvasRef.value
  if (!el) return
  el.style.willChange = 'auto'
  requestAnimationFrame(() => {
    void el.offsetHeight
    el.style.willChange = 'transform'
  })
}
watch(zoom, forceRecomposite)

// 因画布平移/缩放只改 .canvas 变换、不触发编辑器内 scroll/hover 事件，
// 而 block-handle 行高亮/弹层补偿是 fixed 视口定位需随画布重算，
// 故 pan/zoom 变化时派发全局事件通知各编辑器及时重算；
// 因默认 pre flush 在渲染前触发、此时 .canvas 变换未落到 DOM，故用 post flush 等渲染完成后再通知
watch(
  () => [pan.x, pan.y, zoom.value],
  () => {
    // 因 autoHeight 重测只需响应 zoom（宽变→高变），pan 纯平移无需重测，故携带 zoom 供消费者区分
    window.dispatchEvent(new CustomEvent('omnijot:canvas-transform', { detail: { zoom: zoom.value } }))
  },
  { flush: 'post' },
)

// 因 transform 落亚像素会被浏览器渲染发虚，故 pan + origin 取整；
// 纯 translate3d + scale：translate3d 强制合成层、scale 等比例缩放（不用 CSS zoom）
const canvasStyle = computed<CSSProperties>(() => ({
  transform: `translate3d(${Math.round(pan.x + origin.x)}px, ${Math.round(pan.y + origin.y)}px, 0) scale(${zoom.value})`,
  transformOrigin: '0 0',
}))

// 因点阵背景需在任意平移位置都不露白，故固定在视口容器上且 background-position 随 pan 平移
// 因点阵背景随 pan 平移且需 GPU 合成（background-position 每帧重绘会卡顿），故独立成层；
// 因图案 24px 周期重复，背景只需移动 (pan+origin) 对周期的余数，层仅比容器大一圈即可
// 永不露白，且 transform 变化极小（大合成层快速移动反而会跳变）
const DOTS_TILE = 24
const dotsStyle = computed<CSSProperties>(() => {
  const x = ((pan.x + origin.x) % DOTS_TILE + DOTS_TILE) % DOTS_TILE
  const y = ((pan.y + origin.y) % DOTS_TILE + DOTS_TILE) % DOTS_TILE
  return { transform: `translate3d(${x}px, ${y}px, 0)` }
})

const containerStyle = computed<CSSProperties>(() => ({
  // 因 flex item 默认 min-height:auto 会被内容撑到 500px（> 剩余空间），导致溢出 v-main 出现竖向滚动条；
  // scoped CSS 的 min-height:0 在 v-sheet（Vuetify 组件根）上未生效，故 inline 强制允许收缩填满剩余
  minHeight: '0',
}))

// 因块被拖到视口边缘时画布需自动平移（方向与 block-handle 拖段落一致），故按距边缘距离驱动每帧平移
// 因触发边缘过宽（60px）易在拖拽/缩放时误触，故收窄到 32px：需更靠近视口边缘才开始自动滚动
const AUTOPAN_EDGE = 32 // 距视口边缘多少 px 触发
// 因每帧 8px 偏快、易被感知为"突然滚动"，故降为 6px 更平缓
const AUTOPAN_MAX = 6 // 每帧最大平移 px
const autoPan = reactive({ active: false })
const lastMouse = { x: 0, y: 0 }
// 因曲别针需"鼠标靠近才显示"，故用响应式鼠标屏幕坐标驱动 paperclips 重算（lastMouse 仅供 autoPan 用）
const mouseScreen = ref({ x: -9999, y: -9999 })

const updateMousePos = (e: MouseEvent) => {
  lastMouse.x = e.clientX
  lastMouse.y = e.clientY
  mouseScreen.value = { x: e.clientX, y: e.clientY }
}

// 因 resize 时只允许往"能调大块"的方向滚动画布（往调小方向滚会致块达钳制后偏离鼠标），
// 故按被拖边过滤：拖 r/b 只允许右/下边缘（vx/vy 负）、拖 l/t 只允许左/上边缘（vx/vy 正）；
// 该轴已钳制（达 min/max）时整轴禁止滚动
const restrictResizeAutoPan = (vx: number, vy: number): { vx: number; vy: number } => {
  const rs = resizeSession
  if (!rs) return { vx, vy }
  const item = state.items.find((it) => it.id === rs.itemId)
  if (!item) return { vx, vy }
  const handle = rs.handle
  const c = constraintsOf(item)
  const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
  const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
  // 钳制判定（组件已按 min/max 钳制 lastBase，带 0.5 容差防浮点抖动）
  const wClamped = rs.lastBase.w <= minW + 0.5 || (maxW != null && rs.lastBase.w >= maxW - 0.5)
  const hClamped = rs.lastBase.h <= minH + 0.5 || (maxH != null && rs.lastBase.h >= maxH - 0.5)
  // 因对角线手柄（br/tl 等）同时含两方向，水平按 r/l、垂直按 b/t 分别处理
  if (vx) {
    if (handle.includes('r') && (vx > 0 || wClamped)) vx = 0
    else if (handle.includes('l') && (vx < 0 || wClamped)) vx = 0
  }
  if (vy) {
    if (handle.includes('b') && (vy > 0 || hClamped)) vy = 0
    else if (handle.includes('t') && (vy < 0 || hClamped)) vy = 0
  }
  return { vx, vy }
}

// 因 autoPan 由拖拽/缩放共用，故提取"鼠标距视口边缘的速度"，供 tick 滚动与 resize 联结传播判定复用
const autoPanVelocity = (): { vx: number; vy: number } => {
  const cont = canvasContainerRef.value
  if (!cont) return { vx: 0, vy: 0 }
  const r = cont.getBoundingClientRect()
  let vx = 0
  let vy = 0
  if (lastMouse.x < r.left + AUTOPAN_EDGE) vx = Math.min(r.left + AUTOPAN_EDGE - lastMouse.x, AUTOPAN_MAX)
  else if (lastMouse.x > r.right - AUTOPAN_EDGE) vx = -Math.min(lastMouse.x - (r.right - AUTOPAN_EDGE), AUTOPAN_MAX)
  if (lastMouse.y < r.top + AUTOPAN_EDGE) vy = Math.min(r.top + AUTOPAN_EDGE - lastMouse.y, AUTOPAN_MAX)
  else if (lastMouse.y > r.bottom - AUTOPAN_EDGE) vy = -Math.min(lastMouse.y - (r.bottom - AUTOPAN_EDGE), AUTOPAN_MAX)
  return { vx, vy }
}

// 因 autoPan 时 pan 步进（取整）与块补偿（取整）在 zoom≠1 时无法精确抵消（round(rx/z)*z≠round(rx)），
// 逐帧同号累积会让块视觉长期漂移，故用浮点残差累加器把未取整的补偿累计、跨整时再补偿，保证长期零漂移
const panCompAcc = reactive({ x: 0, y: 0 })

const autoPanTick = () => {
  if (!autoPan.active) return
  const { vx, vy } = autoPanVelocity()
  // 因 autoPan 由拖拽/缩放共用，resize 时按被拖方向限制滚动方向（见 restrictResizeAutoPan）
  const { vx: rx, vy: ry } = restrictResizeAutoPan(vx, vy)
  if (rx !== 0 || ry !== 0) {
    // 因 pan 是外部像素平移（不受 scale 影响），画布滚动按视口像素直接累加
    const sx = mobileMode.value ? 0 : Math.round(rx)
    const sy = Math.round(ry)
    if (!mobileMode.value) pan.x += sx
    pan.y += sy
    // 因自动平移时鼠标停住块也不应偏离（块屏幕位置 = 块坐标*z + pan），故按残差补偿被拖拽块坐标
    // 因移动端锁水平，故横向自动平移与横向补偿一并跳过，仅竖向滚动
    panCompAcc.x += mobileMode.value ? 0 : -sx / zoom.value
    panCompAcc.y += -sy / zoom.value
    const compX = Math.round(panCompAcc.x)
    const compY = Math.round(panCompAcc.y)
    panCompAcc.x -= compX
    panCompAcc.y -= compY
    Object.keys(customDragGroup).forEach((id) => {
      const target = state.items.find((it) => it.id === id)
      if (!target) return
      const layout = layoutOf(target)
      if (!mobileMode.value) layout.x += compX
      layout.y += compY
    })
    // 因 resize 时画布自动滚动，被拖块坐标由组件受控（prop 即 content 坐标），
    // 故按"基准矩形 + 相对起始 pan 位移"重算其 content 坐标使缩放手柄跟随鼠标
    compensateResizeAutoPan()
    // 因框选时鼠标停住也需随画布滚动扩展选择框（无 mousemove 驱动），故用最近鼠标位置每帧刷新框选
    if (selectionState.active) updateSelectionAt(lastMouse.x, lastMouse.y)
  }
  requestAnimationFrame(autoPanTick)
}

const startAutoPan = () => {
  if (autoPan.active) return
  autoPan.active = true
  requestAnimationFrame(autoPanTick)
}

const stopAutoPan = () => {
  autoPan.active = false
  panCompAcc.x = 0
  panCompAcc.y = 0
}

const startPan = (e: MouseEvent) => {
  // 因需任意位置右键拖拽都平移，故仅响应右键且不依赖 Vue 的 .right 修饰符（兼容性更稳）
  if (e.button !== 2) return
  e.preventDefault()
  panSession.active = true
  panSession.startClientX = e.clientX
  panSession.startClientY = e.clientY
  panSession.startPanX = pan.x
  panSession.startPanY = pan.y
  isPanning.value = true
}

// 跟踪左键是否处于按下（右键平移禁用判断用；mousedown 捕获阶段读 e.buttons 不可靠）
let leftButtonDown = false
const trackLeftButtonDown = (e: MouseEvent) => {
  if (e.button === 0) leftButtonDown = true
}
const trackLeftButtonUp = () => {
  leftButtonDown = false
}

// 因容器捕获监听（handleCanvasMouseDownCapture）可能随容器重挂载而失效、且编辑器会冒泡拦截右键事件，
// 故在 window 捕获阶段统一处理右键：画布内右键且无活跃左键会话时启动平移，否则拦截
const onGlobalMouseDownCapture = (e: MouseEvent) => {
  if (e.button !== 2) return
  if (!(e.target as HTMLElement).closest?.('.canvas-container')) return
  if (customDrag.active || resizeSession || selectionState.active || leftButtonDown) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  startPan(e)
  e.stopPropagation()
}

// 因编辑器（ProseMirror）内部会通过 stopPropagation 拦截右键事件，故在捕获阶段拦截以确保任意位置右键拖拽都能平移
const handleCanvasMouseDownCapture = (e: MouseEvent) => {
  if (e.button !== 2) return
  // 因左键按住（拖拽块/缩放/框选/编辑器内操作等）时按右键会干扰当前操作，故此时忽略右键（禁用画布移动）
  if (customDrag.active || resizeSession || selectionState.active || leftButtonDown) return
  startPan(e)
  e.stopPropagation()
}

const updatePan = (e: MouseEvent) => {
  if (!panSession.active) return
  // 因 .canvas 变换 translate(round(pan+origin)) 的平移量是外部像素（不受 scale 影响），故 pan 按视口像素直接累加、不除 zoom
  const nx = panSession.startPanX + (e.clientX - panSession.startClientX)
  const ny = panSession.startPanY + (e.clientY - panSession.startClientY)
  // 因触摸/缩放屏下 clientX 可能为小数、亚像素平移会致界面模糊，故取整
  // 因移动端锁水平，故仅竖直方向平移、水平锁定
  pan.x = mobileMode.value ? 0 : Math.round(nx)
  pan.y = Math.round(ny)
}

const stopPan = () => {
  if (!panSession.active) return
  panSession.active = false
  isPanning.value = false
  maybeRebaseOrigin()
}

// 因右键拖拽平移时需避免弹出原生菜单，故窗口级全局禁用右键菜单
const preventContextMenu = (e: Event) => e.preventDefault()

// 因编辑器内 block-handle 拖拽段落时需画布自动平移（useBlockDrag 派发该事件），故监听该事件并取整避免落亚像素
const onCanvasPanEvent = (e: Event) => {
  const detail = (e as CustomEvent<{ dx?: number; dy?: number }>).detail
  if (!detail) return
  const dx = Number(detail.dx) || 0
  const dy = Number(detail.dy) || 0
  if (dx === 0 && dy === 0) return
  // 因 pan 是外部像素平移（不受 scale 影响），故按视口像素直接累加
  if (!mobileMode.value) pan.x += Math.round(dx)
  pan.y += Math.round(dy)
}
const selectionBox = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const selectionState = reactive({
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  extend: false,
  justFinishedSelection: false,
})

const selectionBoxStyle = computed(() => {
  if (!selectionBox.value) return {}
  const { x, y, w, h } = selectionBox.value
  return {
    left: `${roundToPx(x)}px`,
    top: `${roundToPx(y)}px`,
    width: `${roundToPx(w)}px`,
    height: `${roundToPx(h)}px`,
  }
})

const getComponentProps = (item: CanvasItem) => {
  if (item.component === 'RichTextEditor') {
    const cfg = item.config as RichTextConfig
    return {
      doc: cfg.content,
      compact: mobileMode.value,
      autoHeight: cfg.autoHeight === true,
      // 因 autoHeight 状态存于父组件 config，故经事件回写，块内不维护副本
      'onUpdate:autoHeight': (v: boolean) => { cfg.autoHeight = v },
    }
  }
  if (item.component === 'EditableCodeBlock') {
    const cfg = item.config as CodeBlockConfig
    return {
      modelValue: cfg.code,
      language: cfg.language,
    }
  }
  return {}
}

const updateCode = (id: string, code: string) => {
  const item = state.items.find((i) => i.id === id)
  if (item && item.component === 'EditableCodeBlock') {
    ; (item.config as CodeBlockConfig).code = code
  }
}

const updateLanguage = (id: string, lang: string) => {
  const item = state.items.find((i) => i.id === id)
  if (item && item.component === 'EditableCodeBlock') {
    ; (item.config as CodeBlockConfig).language = lang
  }
}

const setComponentRef = (id: string, el: any) => {
  if (el) componentRefs.value[id] = el
  else delete componentRefs.value[id]
}

const layoutOf = (item: CanvasItem): Rect => (mobileMode.value ? item.layout.mobile : item.layout.desktop)

// 因手柄高 28px、块贴近视口顶部时上方放不下（会被画布容器裁剪），
// 故按块在视口内的位置（存储坐标 + 原点 + 平移）决定手柄放上/下方；
// 因手柄视觉高随 zoom 缩放，故阈值取视觉高度，避免高缩放时误判顶部放不下
const HANDLE_HEIGHT = 28
const handlePlacementOf = (item: CanvasItem): 'top' | 'bottom' =>
  visualY(layoutOf(item).y) < Math.round(HANDLE_HEIGHT * zoom.value) ? 'bottom' : 'top'

const handleBarStyle = (item: CanvasItem): CSSProperties => {
  const layout = layoutOf(item)
  // 因拖拽中 handle 需保持按下时的放置（否则 handlePlacementOf 在块拖到视口顶部时
  // 从"块上方"切到"块下方"，导致 handle 与块（ResizeBox）瞬间分离），故拖拽期间锁定 placementLocked
  const dragging = customDrag.active && !!customDragGroup[item.id]
  const bottom = dragging ? customDrag.placementLocked : handlePlacementOf(item) === 'bottom'
  // 因 .canvas 整体 scale(zoom)，若对 (y±HANDLE_HEIGHT) 整体取整，其取整边界与块边缘
  // round(y*zoom) 不一致会在放大时露出 1px 缝隙，故分别取整使底边/顶边贴齐块的视觉边缘
  const handleTop = bottom
    ? roundToPx(layout.y + layout.h)
    : roundToPx(layout.y) - roundToPx(HANDLE_HEIGHT)
  return {
    position: 'absolute',
    top: `${handleTop}px`,
    left: `${roundToPx(layout.x + 10)}px`,
    height: `${roundToPx(HANDLE_HEIGHT)}px`,
    // 因手柄脱离块内层叠上下文后需高于所有块（VDR :z），故置 Z_LAYER.dragHandle：
    // 低于选中描边环让描边连贯盖过拖拽栏，也低于缩放手柄不被其遮挡
    zIndex: Z_LAYER.dragHandle,
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'grab',
    whiteSpace: 'nowrap',
    // 因内联 transform 优先级高于 Vue transition 的 class 会压掉滑出动画（只剩 opacity 生效），
    // 故改用 CSS 变量 --handle-y（贴边微调）+ --handle-slide（滑出方向）由 CSS 组合进动画；
    // --handle-slide 复用 HANDLE_HEIGHT，避免与高度硬编码重复
    '--handle-y': '0px',
    '--handle-slide': `${bottom ? -HANDLE_HEIGHT : HANDLE_HEIGHT}px`,
  }
}

// 因设置栏需与拖拽栏垂直对齐（top/bottom 同放置逻辑）且显示在块右上角，
// 故垂直用 handlePlacementOf 同款计算、水平右对齐块右缘并留右边距（与拖拽栏左对齐相呼应）
const SIDE_SETTINGS_WIDTH = 28
const SIDE_SETTINGS_MARGIN = 8
const sideSettingsStyle = (item: CanvasItem): CSSProperties => {
  const l = layoutOf(item)
  const bottom = handlePlacementOf(item) === 'bottom'
  const top = bottom ? roundToPx(l.y + l.h) : roundToPx(l.y) - roundToPx(HANDLE_HEIGHT)
  return {
    position: 'absolute',
    top: `${top}px`,
    left: `${roundToPx(l.x + l.w) - roundToPx(SIDE_SETTINGS_WIDTH) - roundToPx(SIDE_SETTINGS_MARGIN)}px`,
    zIndex: Z_LAYER.dragHandle,
  }
}

// 因选中描边环向外扩 2px（与原 box-shadow 0 0 0 2px 一致），故 overlay 相对块边缘外扩该宽度
const OUTLINE_PX = 2
const selectedOutlineStyle = (item: CanvasItem): CSSProperties => {
  const l = layoutOf(item)
  // 因 .canvas 整体 scale(zoom)，按块边缘视觉分别取整外扩，保证描边环贴齐块边缘
  return {
    left: `${roundToPx(l.x) - roundToPx(OUTLINE_PX)}px`,
    top: `${roundToPx(l.y) - roundToPx(OUTLINE_PX)}px`,
    width: `${roundToPx(l.w) + roundToPx(OUTLINE_PX * 2)}px`,
    height: `${roundToPx(l.h) + roundToPx(OUTLINE_PX * 2)}px`,
  }
}

const getSelectedItemIds = (item: CanvasItem) => {
  const selected = state.selectedIds.has(item.id) && state.selectedIds.size > 1
    ? Array.from(state.selectedIds)
    : [item.id]
  return selected
}

// 因需块跟随鼠标且画布平移时块自动补偿（无需 hack VDR 内部），
// 故块世界坐标 = 初始 + 鼠标位移 - (pan - panStart)
const customDrag = reactive({
  active: false,
  startClientX: 0,
  startClientY: 0,
  panStartX: 0,
  panStartY: 0,
  // 按下时 handle 的放置（top/bottom），拖拽中锁定该放置防 handlePlacementOf 切换导致 handle 跳位
  placementLocked: false,
})
let customDragGroup: Record<string, { x: number; y: number }> = {}
// 粘贴链接：记录已用曲别针"粘贴"的块对（key 为两 id 排序后 join），拖动一个时另一块跟着动
const linkedPairs = ref<Set<string>>(new Set())
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
const collectLinkedIds = (rootId: string): Set<string> => {
  const out = new Set<string>()
  const queue = [rootId]
  while (queue.length) {
    const id = queue.pop()!
    if (out.has(id)) continue
    out.add(id)
    linkedPairs.value.forEach((key) => {
      const [x, y] = key.split('|')
      if (x === id && !out.has(y)) queue.push(y)
      else if (y === id && !out.has(x)) queue.push(x)
    })
  }
  return out
}
const toggleLink = (a: string, b: string) => {
  const key = pairKey(a, b)
  const next = new Set(linkedPairs.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  linkedPairs.value = next
}

const startCustomDrag = (item: CanvasItem, e: MouseEvent) => {
  if (e.button !== 0) return
  if (!isEditMode.value) return
  handleSelect(item.id, e)
  customDrag.active = true
  customDrag.startClientX = e.clientX
  customDrag.startClientY = e.clientY
  customDrag.panStartX = pan.x
  customDrag.panStartY = pan.y
  // 锁定按下时的 handle 放置，拖拽中不随 handlePlacementOf 切换（否则块拖到视口顶部时 handle 跳向块下方）
  customDrag.placementLocked = handlePlacementOf(item) === 'bottom'
  customDragGroup = {}
  getSelectedItemIds(item).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (target) customDragGroup[id] = { x: layoutOf(target).x, y: layoutOf(target).y }
  })
  // 因曲别针"粘贴"的块需随被拖块一起移动，故把链接传递可达的块也加入拖拽组；
  // 因移动端不启用块联结（曲别针隐藏），故仅桌面端收集
  if (!mobileMode.value) {
    collectLinkedIds(item.id).forEach((id) => {
      if (customDragGroup[id]) return
      const target = state.items.find((it) => it.id === id)
      if (target) customDragGroup[id] = { x: layoutOf(target).x, y: layoutOf(target).y }
    })
  }
  window.addEventListener('pointermove', onCustomDragMove)
  window.addEventListener('pointerup', onCustomDragUp)
  window.addEventListener('mousemove', onCustomDragMove)
  window.addEventListener('mouseup', onCustomDragUp)
  e.preventDefault()
  // 因拖拽中鼠标会扫过编辑器触发 block-handle popup/高亮，故复用 body 类跨编辑器全局抑制
  document.body.classList.add('block-handle-dragging')
  // 因拖拽中块可能超出视口使 document 出现竖向滚动条，故临时锁 html/body 滚动、松开恢复
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  startAutoPan() // 拖到视口边缘时画布自动平移
}

const onCustomDragMove = (e: MouseEvent) => {
  if (!customDrag.active) return
  // 因画布被 scale(zoom)，视口鼠标位移需除以 zoom 才等于 content 位移
  const dx = (e.clientX - customDrag.startClientX) / zoom.value
  const dy = (e.clientY - customDrag.startClientY) / zoom.value
  // 因 pan 是外部像素平移，换算成 content 位移需再除 zoom
  const panDx = (pan.x - customDrag.panStartX) / zoom.value
  const panDy = (pan.y - customDrag.panStartY) / zoom.value
  Object.keys(customDragGroup).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    if (!target) return
    const origin = customDragGroup[id]
    const layout = layoutOf(target)
    // 因块屏幕位置（= 块坐标 + pan）需落在整数像素上，故取整
    layout.x = mobileMode.value ? origin.x : Math.round(origin.x + dx - panDx)
    layout.y = Math.round(origin.y + dy - panDy)
    if (!mobileMode.value) snapLayoutToOthers(target, layout)
  })
}

// 因自定义拖拽绕过 VDR 的 handleDrag（snap 吸附不再触发），
// 故拖动时手动对每个被拖块与其他块做边缘/中线对齐吸附（容差内取最近的边）
const SNAP_TOLERANCE = 10
const PAPERCLIP_PROXIMITY = 32
const snapLayoutToOthers = (target: CanvasItem, layout: Rect) => {
  const candidatesX: number[] = []
  const candidatesY: number[] = []
  state.items.forEach((other) => {
    if (other.id === target.id || customDragGroup[other.id]) return
    const o = layoutOf(other)
    candidatesX.push(
      o.x - layout.x, o.x + o.w - layout.x,
      o.x - (layout.x + layout.w), o.x + o.w - (layout.x + layout.w),
      (o.x + o.w / 2) - (layout.x + layout.w / 2),
    )
    candidatesY.push(
      o.y - layout.y, o.y + o.h - layout.y,
      o.y - (layout.y + layout.h), o.y + o.h - (layout.y + layout.h),
      (o.y + o.h / 2) - (layout.y + layout.h / 2),
    )
  })
  const nearest = (arr: number[]) => {
    let best = 0
    let bestAbs = Infinity
    arr.forEach((d) => {
      const abs = Math.abs(d)
      if (abs <= SNAP_TOLERANCE && abs < bestAbs) {
        bestAbs = abs
        best = d
      }
    })
    return best
  }
  layout.x += nearest(candidatesX)
  layout.y += nearest(candidatesY)
}

const isAdjacent = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x + a.w - b.x) <= SNAP_TOLERANCE ||
  Math.abs(b.x + b.w - a.x) <= SNAP_TOLERANCE ||
  Math.abs(a.y + a.h - b.y) <= SNAP_TOLERANCE ||
  Math.abs(b.y + b.h - a.y) <= SNAP_TOLERANCE

// 计算两块连接点：位于**接触段的中点**（左右相邻 → 共享垂直边与两块纵向重叠段的中点；
// 上下相邻 → 共享水平边与横向重叠段的中点），供曲别针定位
const connectionPoint = (a: Rect, b: Rect): { x: number; y: number } => {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
  if (Math.abs(a.x + a.w - b.x) <= SNAP_TOLERANCE || Math.abs(b.x + b.w - a.x) <= SNAP_TOLERANCE) {
    const edgeX = Math.abs(a.x + a.w - b.x) <= SNAP_TOLERANCE ? a.x + a.w : b.x + b.w
    return { x: edgeX, y: (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2 }
  }
  if (Math.abs(a.y + a.h - b.y) <= SNAP_TOLERANCE || Math.abs(b.y + b.h - a.y) <= SNAP_TOLERANCE) {
    const edgeY = Math.abs(a.y + a.h - b.y) <= SNAP_TOLERANCE ? a.y + a.h : b.y + b.h
    return { x: (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2, y: edgeY }
  }
  return { x: (acx + bcx) / 2, y: (acy + bcy) / 2 }
}

// 因缩放手柄已 Teleport 到 .canvas 顶层（z=1000 高于曲别针 998），曲别针无需再让位，
// 保持 CSS 的 z=998 即可在选中块（z=500）之上可点，故不再动态降 z

// 因富文本开启"高度自适应"时块高由内容驱动、用户不可垂直缩放，故以此判定过滤垂直手柄
const isAutoHeight = (item: CanvasItem): boolean =>
  item.component === 'RichTextEditor' && (item.config as RichTextConfig).autoHeight === true

// 因开关状态存于父组件 config，经事件回写即可驱动 RichTextEditor 的 autoHeight prop
const setAutoHeight = (item: CanvasItem, v: boolean) => {
  if (item.component !== 'RichTextEditor') return
  ;(item.config as RichTextConfig).autoHeight = v
}

// 因 ProseKit 行高亮 popup 弹出时会插在块顶部正中间缩放手柄（.handle-tm）上方，
// 而手柄已 Teleport 脱离 .drag-wrapper（原 CSS 隐藏规则失效），故按 popup 显隐过滤 tm 手柄
const resizeHandlesOf = (item: CanvasItem): string[] => {
  // 因 autoHeight 时高度由内容决定，故隐藏全部含垂直方向的手柄，仅保留水平
  if (isAutoHeight(item)) return ['ml', 'mr']
  if (mobileMode.value) return ['tm', 'bm']
  if (popupBlockId.value === item.id) return ['tl', 'tr', 'ml', 'mr', 'bl', 'bm', 'br']
  return ['tl', 'tm', 'tr', 'ml', 'mr', 'bl', 'bm', 'br']
}

// 曲别针列表：所有相邻（或已粘贴）的块对显示在连接点，标记是否已粘贴；
// 不自动跟随——只有点击曲别针启用粘贴后，拖动一块才带动另一块；
// 因曲别针只在鼠标靠近时才显示，故把布局坐标换算成屏幕坐标（layout + origin + pan）与鼠标判距；
// 因富文本 popup 上侧开启会盖住连接点处的曲别针，故此时隐藏全部曲别针
const paperclips = computed(() => {
  const list: { a: string; b: string; x: number; y: number; linked: boolean }[] = []
  if (mobileMode.value || popupTopOpen.value) return list
  const items = state.items
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const ra = layoutOf(items[i])
      const rb = layoutOf(items[j])
      const key = pairKey(items[i].id, items[j].id)
      const linked = linkedPairs.value.has(key)
      if (!linked && !isAdjacent(ra, rb)) continue
      const pt = connectionPoint(ra, rb)
      // 因曲别针渲染在 .canvas 内（随 pan+origin 变换、且 .canvas 位于容器下方工具栏之下），
      // 故屏幕位置 = 布局坐标 + origin + pan + 画布容器的视口偏移，再与视口鼠标坐标判距
      const cr = canvasContainerRef.value?.getBoundingClientRect()
      // 因 .canvas 被 scale(zoom)，曲别针 content 坐标需乘 zoom 才等于其视口屏幕位置
      const sx = pt.x * zoom.value + origin.x + pan.x + (cr?.left ?? 0)
      const sy = pt.y * zoom.value + origin.y + pan.y + (cr?.top ?? 0)
      if (Math.hypot(sx - mouseScreen.value.x, sy - mouseScreen.value.y) > PAPERCLIP_PROXIMITY) continue
      list.push({ a: items[i].id, b: items[j].id, x: pt.x, y: pt.y, linked })
    }
  }
  return list
})

// 因 VDR 自带冲突检测仅在它自己的 dragging/resizing 结束触发，而块拖拽走自定义路径（draggable=false），
// 故松开时自行检测被拖块与其他块重叠，重叠则回退到拖拽起点
const resolveDragConflict = () => {
  const draggedIds = new Set(Object.keys(customDragGroup))
  state.items.forEach((target) => {
    if (!draggedIds.has(target.id)) return
    const layout = layoutOf(target)
    const conflict = state.items.some((other) => {
      if (other.id === target.id || draggedIds.has(other.id)) return false
      const ol = layoutOf(other)
      return layout.x < ol.x + ol.w && layout.x + layout.w > ol.x && layout.y < ol.y + ol.h && layout.y + layout.h > ol.y
    })
    if (conflict) {
      const origin = customDragGroup[target.id]
      layout.x = origin.x
      layout.y = origin.y
    }
  })
}

const onCustomDragUp = () => {
  customDrag.active = false
  window.removeEventListener('pointermove', onCustomDragMove)
  window.removeEventListener('pointerup', onCustomDragUp)
  window.removeEventListener('mousemove', onCustomDragMove)
  window.removeEventListener('mouseup', onCustomDragUp)
  stopAutoPan()
  // 因拖拽结束需恢复编辑器 popup/高亮，故移除 body 拖拽类
  document.body.classList.remove('block-handle-dragging')
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  resolveDragConflict()
  maybeRebaseOrigin()
}

// resize 会话：记录手柄、链接组各块起始矩形、最近一次组件上报的基准矩形与起始 pan
// （autoPan 补偿 = 基准矩形 + 相对起始 pan 的位移，坐标全为 content 世界坐标）
interface ResizeSession {
  itemId: string
  handle: string
  starts: Record<string, Rect>
  lastBase: Rect
  panStartX: number
  panStartY: number
}
let resizeSession: ResizeSession | null = null

// 因 resize 时画布自动滚动会让被拖块偏离鼠标，故按"基准矩形 + 相对起始 pan 的位移"补偿：
// 被拖边（手柄所在边）钉屏跟手、锚定边不补偿（content 不动、随画布滚）；
// 钳制维（已到 min/max）不补偿、该方向整组随画布滚动。水平/垂直同此规则（对称）
const applyPanCorrection = (
  base: Rect,
  handle: string,
  c: Required<ResizeConstraints>,
  dpX: number,
  dpY: number,
): Rect => {
  const out = { ...base }
  const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
  const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
  // 钳制判定（组件上报的 base 已按 min/max 钳制，带 0.5 容差防浮点抖动）
  const wClamped = base.w <= minW + 0.5 || (maxW != null && base.w >= maxW - 0.5)
  const hClamped = base.h <= minH + 0.5 || (maxH != null && base.h >= maxH - 0.5)
  if (dpY && !hClamped) {
    // 因拖 t 改 y+height（上缘钉屏、下缘锚定随画布滚）、拖 b 改 height（下缘钉屏、上缘锚定）；
    // 补偿后按 min/max 钳制（锚定边保持 y+h 不变），钳制到极限后该方向不再钉屏（整组随画布滚）
    if (handle.includes('t')) {
      const rawH = out.h + dpY
      const nh = clampVal(rawH, minH, maxH)
      out.y = out.y - dpY + (rawH - nh)
      out.h = nh
    } else {
      out.h = clampVal(out.h - dpY, minH, maxH)
    }
  }
  if (dpX && !wClamped) {
    if (handle.includes('l')) {
      const rawW = out.w + dpX
      const nw = clampVal(rawW, minW, maxW)
      out.x = out.x - dpX + (rawW - nw)
      out.w = nw
    } else {
      out.w = clampVal(out.w - dpX, minW, maxW)
    }
  }
  return out
}

// 因 resize 需与拖拽一致支持边缘吸附，故按被拖边（手柄方向）对齐其他块的边/中线；
// 仅调整被拖边（锚定边不动），吸附容差同拖拽 SNAP_TOLERANCE，并保持 min/max 钳制
const snapResizeEdges = (handle: string, rect: Rect, c: Required<ResizeConstraints>): Rect => {
  const out = { ...rect }
  const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
  const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
  const nearest = (cur: number, targets: number[]): number => {
    let best = 0
    let bestAbs = Infinity
    targets.forEach((t) => {
      const d = t - cur
      const abs = Math.abs(d)
      if (abs <= SNAP_TOLERANCE && abs < bestAbs) {
        bestAbs = abs
        best = d
      }
    })
    return best
  }
  const xs: number[] = []
  const ys: number[] = []
  state.items.forEach((other) => {
    if (other.id === resizeSession?.itemId) return
    const o = layoutOf(other)
    xs.push(o.x, o.x + o.w, o.x + o.w / 2)
    ys.push(o.y, o.y + o.h, o.y + o.h / 2)
  })
  if (handle.includes('r')) out.w = clampVal(out.w + nearest(out.x + out.w, xs), minW, maxW)
  if (handle.includes('l')) {
    const d = nearest(out.x, xs)
    if (d !== 0) {
      const nw = clampVal(out.w - d, minW, maxW)
      out.x = out.x + out.w - nw // 右缘锚定
      out.w = nw
    }
  }
  if (handle.includes('b')) out.h = clampVal(out.h + nearest(out.y + out.h, ys), minH, maxH)
  if (handle.includes('t')) {
    const d = nearest(out.y, ys)
    if (d !== 0) {
      const nh = clampVal(out.h - d, minH, maxH)
      out.y = out.y + out.h - nh // 下缘锚定
      out.h = nh
    }
  }
  return out
}

// 因被拖块坐标由组件受控（prop 即 content 世界坐标），故把补偿结果直接写回 layout；
// 且因 autoPan 滚动时联结块 B 若贴 A 底会被钉屏压缩，故滚动期间冻结联结传播（B 整体随画布滚）
const applyResizeLayout = (item: CanvasItem, propagate: boolean) => {
  const rs = resizeSession
  if (!rs) return
  // 因 pan 是外部像素平移，换算成 content 补偿量需除 zoom
  const final = applyPanCorrection(
    rs.lastBase,
    rs.handle,
    constraintsOf(item),
    (pan.x - rs.panStartX) / zoom.value,
    (pan.y - rs.panStartY) / zoom.value,
  )
  const snapped = snapResizeEdges(rs.handle, final, constraintsOf(item))
  const layout = layoutOf(item)
  layout.x = Math.round(snapped.x)
  layout.y = Math.round(snapped.y)
  layout.w = Math.round(snapped.w)
  layout.h = Math.round(snapped.h)
  if (propagate) syncLinkedEdges(item, snapped.x, snapped.y, snapped.w, snapped.h)
}

// 因 autoPan 每帧 pan 变化且鼠标可能停住（无 mousemove），故在 rAF 循环内补偿被拖块（见 autoPanTick）；
// 滚动期间冻结联结传播（B 随画布滚），避免被 A 底钉屏压缩
const compensateResizeAutoPan = () => {
  const rs = resizeSession
  if (!rs) return
  const item = state.items.find((it) => it.id === rs.itemId)
  if (item) applyResizeLayout(item, false)
}

const clampVal = (v: number, min: number, max: number | null) => {
  if (v < min) return min
  if (max != null && v > max) return max
  return v
}

const neighborsOf = (id: string): string[] => {
  const out: string[] = []
  linkedPairs.value.forEach((key) => {
    const [x, y] = key.split('|')
    if (x === id) out.push(y)
    else if (y === id) out.push(x)
  })
  return out
}

// 因仅在被拖块 A 的 resize 会话中调用，故直接从会话取链接组起始矩形转交共用传播
const syncLinkedEdges = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const rs = resizeSession
  if (!rs || rs.itemId !== item.id) return
  propagateLinkedEdges(item, { x, y, w, h }, rs.starts)
}

// 沿链接图 BFS 传播共享边（resize 与 autoHeight 共用）：每块的共享边跟随其父块移动后的边，
// 尺寸按自身 min/max 钳制（与 VDR 的 min=minWidth+8 一致）；链中间块被钳制后其远端边位移继续传给下一块。
// 位置按"起始 + 父块总位移"重算（不逐帧累加，防长距离错位）。
const propagateLinkedEdges = (item: CanvasItem, rect: Rect, starts: Record<string, Rect>) => {
  const positions: Record<string, Rect> = {}
  // 因 autoPan 平移改变了联结块 layout，positions 用当前布局初始化以保留自由边平移；
  // 方位判定与位移仍基于 starts（会话起始，避免随动干扰）
  Object.keys(starts).forEach((id) => {
    const target = state.items.find((it) => it.id === id)
    positions[id] = target ? { ...layoutOf(target) } : { ...starts[id] }
  })
  positions[item.id] = { ...rect }
  // 分维 BFS 传播共享边（一块可分别从水平父与垂直父继承 x/w 与 y/h）。
  // 左/上邻居反向跟当前块（共享边贴合当前块的左/上缘），右/下邻居正向传播（跟随右/下缘）——
  // 链条中间块位置被上游驱动后，其反向邻居继续跟随，保持整链贴合。
  // 同向边缘齐平（左右缘对齐）由用户手动布局决定，不在此自动强制
  const queue = [item.id]
  const seenX = new Set([item.id])
  const seenY = new Set([item.id])
  while (queue.length) {
    const pid = queue.shift()!
    const pRect = positions[pid]
    const pStart = starts[pid]
    if (!pRect || !pStart) continue
    neighborsOf(pid).forEach((nid) => {
      const nStart = starts[nid]
      const target = state.items.find((it) => it.id === nid)
      if (!nStart || !target) return
      const c = constraintsOf(target)
      const minW = (c.minWidth ?? 0) + 8, maxW = c.maxWidth ?? null
      const minH = (c.minHeight ?? 0) + 8, maxH = c.maxHeight ?? null
      let enqueue = false
      // 用起始矩形判定方位（避免随动的邻居位置变化干扰判定）。
      // 交叉轴也贴合时（对角台阶邻居）只按主方向传播，避免被另一轴拉走（如上块被水平平移钉屏）
      const xTouching = Math.abs(pStart.x + pStart.w - nStart.x) <= SNAP_TOLERANCE ||
        Math.abs(nStart.x + nStart.w - pStart.x) <= SNAP_TOLERANCE
      const yTouching = Math.abs(pStart.y + pStart.h - nStart.y) <= SNAP_TOLERANCE ||
        Math.abs(nStart.y + nStart.h - pStart.y) <= SNAP_TOLERANCE
      if (!seenX.has(nid) && Math.abs(pStart.x + pStart.w - nStart.x) <= SNAP_TOLERANCE && !yTouching) {
        // N 在 P 右：左缘跟右缘；宽度 = N 当前右缘 - 新左缘（autoPan 平移时不变，拖动压缩时跟随）
        seenX.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        const curRight = nNew.x + nNew.w
        nNew.x = pRect.x + pRect.w
        nNew.w = clampVal(curRight - nNew.x, minW, maxW)
        positions[nid] = nNew
        enqueue = true
      } else if (!seenX.has(nid) && Math.abs(nStart.x + nStart.w - pStart.x) <= SNAP_TOLERANCE && !yTouching) {
        // N 在 P 左：N 右缘精确贴合 P 左缘（N 左缘随 N.w 移动，钳制时仍贴合；autoPan 时左缘随之补偿钉屏幕）
        seenX.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        nNew.w = clampVal(pRect.x - nNew.x, minW, maxW)
        nNew.x = pRect.x - nNew.w
        positions[nid] = nNew
        enqueue = true
      }
      if (!seenY.has(nid) && Math.abs(pStart.y + pStart.h - nStart.y) <= SNAP_TOLERANCE && !xTouching) {
        // N 在 P 下：上缘跟下缘；高度 = N 当前下缘 - 新上缘（autoPan 平移时不变，拖动压缩时跟随）
        seenY.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        const curBottom = nNew.y + nNew.h
        nNew.y = pRect.y + pRect.h
        nNew.h = clampVal(curBottom - nNew.y, minH, maxH)
        positions[nid] = nNew
        enqueue = true
      } else if (!seenY.has(nid) && Math.abs(nStart.y + nStart.h - pStart.y) <= SNAP_TOLERANCE && !xTouching) {
        // N 在 P 上：N 下缘精确贴合 P 上缘（N 上缘随 N.h 移动，钳制时仍贴合）
        seenY.add(nid)
        const nNew = positions[nid] ?? { ...nStart }
        nNew.h = clampVal(pRect.y - nNew.y, minH, maxH)
        nNew.y = pRect.y - nNew.h
        positions[nid] = nNew
        enqueue = true
      }
      if (enqueue) queue.push(nid)
    })
  }
  // 因被拖块 A 的 VDR 坐标在 autoPan 时已由 compensateResizeAutoPan 补偿（保持屏幕位置），
  // 传播结果直接写回内容坐标即可——联结块基于补偿后的 A 传播，随之保持屏幕位置并与 A 贴合
  Object.keys(positions).forEach((id) => {
    if (id === item.id) return
    const target = state.items.find((it) => it.id === id)
    if (!target) return
    const p = positions[id]
    const tl = layoutOf(target)
    tl.x = Math.round(p.x)
    tl.y = Math.round(p.y)
    tl.w = Math.round(p.w)
    tl.h = Math.round(p.h)
  })
}

// 因需记录 resize 会话起始（手柄、链接组各块起始矩形、起始 pan）供后续补偿与传播，故监听 resizestart
const onResizeStart = (item: CanvasItem, handle: string) => {
  const starts: Record<string, Rect> = {}
  // 因移动端不启用块联结（曲别针隐藏、缩放只调高度不联动），故仅桌面端收集链接块起始矩形
  if (!mobileMode.value) {
    collectLinkedIds(item.id).forEach((id) => {
      const target = state.items.find((it) => it.id === id)
      if (target) starts[id] = { ...layoutOf(target) }
    })
  }
  resizeSession = {
    itemId: item.id,
    handle,
    starts,
    lastBase: { ...layoutOf(item) },
    panStartX: pan.x,
    panStartY: pan.y,
  }
}

// 因需 resize 过程中共享边实时跟随（而非仅松手时），故监听 resizing；
// 并因 resize 到视口边缘时需自动滚动画布，故 resize 期间启动 autoPan（拖拽同款，startAutoPan 幂等）
const onResizing = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const rs = resizeSession
  if (!rs || rs.itemId !== item.id) return
  rs.lastBase = { x, y, w, h }
  // 因 autoPan 滚动期间需冻结联结传播（B 随画布滚、避免钉屏压缩）；
  // 判定用"实时是否在滚动"（鼠标在边缘且该方向允许滚动），而非会话累计 pan 变化——
  // 否则 autoPan 滚过一次后 B 永久冻结，鼠标离开边缘也不恢复贴 A 底（来回拖钳制边即"卡住"）
  const { vx, vy } = autoPanVelocity()
  const { vx: rx, vy: ry } = restrictResizeAutoPan(vx, vy)
  applyResizeLayout(item, rx === 0 && ry === 0)
  startAutoPan()
}

const onResizeStop = (item: CanvasItem, x: number, y: number, w: number, h: number) => {
  const rs = resizeSession
  if (rs && rs.itemId === item.id) {
    rs.lastBase = { x, y, w, h }
    // 先停 autoPan 再落位，使松手瞬间联结传播恢复（B 贴回 A 底）
    stopAutoPan()
    applyResizeLayout(item, true)
  } else {
    const layout = layoutOf(item)
    layout.x = Math.round(x)
    layout.y = Math.round(y)
    layout.w = Math.round(w)
    layout.h = Math.round(h)
  }
  resizeSession = null
}

// 因移动端块纵向堆叠，某块 autoHeight 高度变化后其下方块位置须跟随平移（delta 可正可负），否则互相重叠
const shiftBlocksBelow = (item: CanvasItem, delta: number) => {
  if (delta === 0) return
  state.items
    .filter((it) => it.id !== item.id && it.layout.mobile.y > item.layout.mobile.y)
    .sort((a, b) => a.layout.mobile.y - b.layout.mobile.y)
    .forEach((it) => { it.layout.mobile.y += delta })
}

// 因 autoHeight 块增长到与别的块重叠时需像钳制一样把重叠块下推（单向推动：
// 高度减小不移动别的块，避免无条件联结传播把邻块拉来推去），
// 故把横向重叠（x 相交）的块按上缘排序后，仅在块顶压到推动线时下推贴线并连锁；
// 未压到的块保持原位（否则累积底边会把不重叠的块也误推走）
const pushOverlapped = (item: CanvasItem) => {
  const layout = layoutOf(item)
  const isOverlappingX = (o: Rect) => layout.x < o.x + o.w && layout.x + layout.w > o.x
  const column = state.items
    .filter((other) => other.id !== item.id && isOverlappingX(layoutOf(other)))
    .sort((a, b) => layoutOf(a).y - layoutOf(b).y)
  let cursor = layout.y + layout.h
  column.forEach((other) => {
    const o = layoutOf(other)
    if (o.y < cursor) {
      o.y = cursor
      cursor = o.y + o.h
    }
  })
}

// 因 autoHeight 块高度由内容驱动（富文本经 omnijot:auto-height 上报），故写入当前布局并保底 minHeight
const onAutoHeight = (e: Event) => {
  const detail = (e as CustomEvent<{ id?: string; height?: number; cursorY?: number }>).detail
  if (!detail?.id || typeof detail.height !== 'number') return
  const item = state.items.find((it) => it.id === detail.id)
  if (!item || item.component !== 'RichTextEditor') return
  const minH = (constraintsOf(item).minHeight ?? 0) + 8
  const h = Math.max(Math.round(detail.height), minH)
  const layout = layoutOf(item)
  if (layout.h !== h) {
    if (mobileMode.value) {
      // 因移动端纵向堆叠，高度变化后须将下方堆叠块整体平移以保持不重叠（先算 delta 再覆盖高度）
      shiftBlocksBelow(item, h - layout.h)
      layout.h = h
    } else {
      const prevH = layout.h
      layout.h = h
      // 因 autoHeight 块高度由内容驱动、非用户拖拽，故不沿联结传播推动邻块（否则输入时邻块被持续推走）；
      // 仅当增长到与别的块重叠时像钳制一样把重叠块下推让位（单向：高度减小不移动别的块）
      if (h > prevH) pushOverlapped(item)
    }
  }
  // 因输入行随内容增长会超出视口，故光标行超出视口底部时平移画布使其可见；
  // 因用户手动拖画布（右键平移）时不应被光标跟随反向拉回，故拖拽中跳过
  if (typeof detail.cursorY === 'number' && !isPanning.value) followCursor(item, detail.cursorY)
}

// 因 autoHeight 输入时需让光标行保持在视口内，故按光标行视觉位置与视口底界差平移 pan.y
const CURSOR_VISIBLE_MARGIN = 24
const followCursor = (item: CanvasItem, cursorY: number) => {
  const cont = canvasContainerRef.value
  if (!cont) return
  const cr = cont.getBoundingClientRect()
  const l = layoutOf(item)
  // 块视觉顶 = 容器顶 + 块坐标*zoom + origin + pan（pan/origin 为视口像素）；cursorY 为已缩放视觉像素
  const cursorBottom = cr.top + l.y * zoom.value + origin.y + pan.y + cursorY
  const over = cursorBottom - (cr.bottom - CURSOR_VISIBLE_MARGIN)
  if (over > 0) pan.y -= Math.round(over)
}

const handleSelect = (id: string, e?: MouseEvent) => {
  const isSelected = state.selectedIds.has(id)
  const selectedCount = state.selectedIds.size
  const isCtrl = e?.ctrlKey ?? false

  if (isCtrl) {
    const newSet = new Set(state.selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    state.selectedIds = newSet
  } else if (isSelected && selectedCount > 1) {
    // 因拖拽手柄时不应把多选收缩为单选，故保留当前集合
    return
  } else {
    state.selectedIds = new Set([id])
  }
}

const updateSelectionBox = () => {
  const x = Math.min(selectionState.startX, selectionState.currentX)
  const y = Math.min(selectionState.startY, selectionState.currentY)
  const w = Math.abs(selectionState.currentX - selectionState.startX)
  const h = Math.abs(selectionState.currentY - selectionState.startY)
  selectionBox.value = w > 2 || h > 2 ? { x, y, w, h } : null
}

const isRectIntersectingItem = (rect: { x: number; y: number; w: number; h: number }, item: CanvasItem) => {
  const itemRect = layoutOf(item)
  return itemRect.x < rect.x + rect.w && itemRect.x + itemRect.w > rect.x && itemRect.y < rect.y + rect.h && itemRect.y + itemRect.h > rect.y
}

const onCanvasMouseDown = (e: MouseEvent) => {
  startSelection(e)
  startPan(e)
}

const startSelection = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (e.button !== 0) return
  if (target.closest('.drag-wrapper') || target.closest('.drag-handle') || target.closest('.toolbar')) return

  const rect = canvasContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  e.preventDefault()
  selectionState.active = true
  selectionState.extend = e.ctrlKey
  selectionState.justFinishedSelection = false
  // 因事件已挂容器级而 .canvas 自带 pan 平移与 scale(zoom)，故换算存储坐标 = (视口 - 容器位置 - pan - origin) / zoom
  selectionState.startX = (e.clientX - rect.left - pan.x - origin.x) / zoom.value
  selectionState.startY = (e.clientY - rect.top - pan.y - origin.y) / zoom.value
  selectionState.currentX = selectionState.startX
  selectionState.currentY = selectionState.startY
  updateSelectionBox()
  startAutoPan() // 框选拖到视口边缘时画布自动滚动
}

// 因框选自动滚动时鼠标可能停住（无 mousemove 驱动），故把"由坐标刷新框选"独立供 autoPan 每帧调用
const updateSelectionAt = (clientX: number, clientY: number) => {
  if (!selectionState.active) return
  const rect = canvasContainerRef.value?.getBoundingClientRect()
  if (!rect) return
  selectionState.currentX = (clientX - rect.left - pan.x - origin.x) / zoom.value
  selectionState.currentY = (clientY - rect.top - pan.y - origin.y) / zoom.value
  updateSelectionBox()
}

const updateSelection = (e: MouseEvent) => {
  if (!selectionState.active) return
  e.preventDefault()
  updateSelectionAt(e.clientX, e.clientY)
}

const onCanvasMousemove = (e: MouseEvent) => {
  updateSelection(e)
  hoverFocusBlock(e)
}

// 因画布容器 overflow:hidden 但内容会溢出，聚焦编辑器触发的默认 scrollIntoView
// 会把容器滚出偏移、导致整个画面位移，故归零容器滚动并由 pan 独占控制位置
const resetCanvasScroll = () => {
  const c = canvasContainerRef.value
  if (c && (c.scrollLeft !== 0 || c.scrollTop !== 0)) {
    c.scrollLeft = 0
    c.scrollTop = 0
  }
}

// 因 hover 选中块后内容物应同步可编辑（光标可直接进入），故聚焦块内编辑器（富文本 ProseMirror 或代码 textarea）；
// 聚焦用 preventScroll 阻止浏览器默认滚动（见 resetCanvasScroll 注释）
const focusBlockContent = (id: string) => {
  nextTick(() => {
    resetCanvasScroll()
    const wrapper = document.querySelector(`.drag-wrapper[data-id="${id}"]`)
    const pm = wrapper?.querySelector('.ProseMirror') as HTMLElement | null
    if (pm) {
      pm.focus({ preventScroll: true })
      return
    }
    const ta = wrapper?.querySelector('textarea') as HTMLElement | null
    if (ta) ta.focus({ preventScroll: true })
  })
}

// 因 ProseKit 行高亮 popup 弹出时会插在块顶部正中间缩放手柄（.handle-tm）上方，
// 故按 popup 显隐记录所在块 id，以便只隐藏该块 tm（其余缩放手柄不受影响）
const popupBlockId = ref<string | null>(null)
const onBlockPopupChange = (e: Event) => {
  const detail = (e as CustomEvent).detail as { open?: boolean; blockId?: string | null }
  // 因块间切换时旧块的关闭事件会误清新块的 popupBlockId，
  // 故仅当关闭事件与当前 popupBlockId 匹配时才清除，其余情况保持
  if (detail.open && detail.blockId) {
    popupBlockId.value = detail.blockId
  } else if (!detail.open && detail.blockId && popupBlockId.value === detail.blockId) {
    popupBlockId.value = null
  }
}

// 因富文本 popup 上侧开启时会盖住连接点处的曲别针，故该状态为 true 时隐藏全部曲别针
const popupTopOpen = ref(false)
const onBlockPopupTopChange = (e: Event) => {
  const detail = (e as CustomEvent).detail as { open?: boolean }
  popupTopOpen.value = !!detail.open
}

// 因需"鼠标落在哪个块的 VDR 框区域内就聚焦哪个块"（只按框区域判断，不看内容元素），
// 故用鼠标坐标对每个块的 getBoundingClientRect 做点在矩形内测试；重叠时取 z 最高的块。
// 因手柄让出 2px 给选中块的 box-shadow 描边，鼠标从内容区平滑移到拖拽栏会先经过这条缝隙，
// 故缝隙带（手柄朝向块一侧 HANDLE_GAP 内）也命中手柄所属块，避免中途焦点转移到背后组件
const HANDLE_GAP = 2

const hitHandleGap = (clientX: number, clientY: number): string | null => {
  let hit: string | null = null
  state.items.forEach((item) => {
    if (!state.selectedIds.has(item.id)) return
    const el = document.querySelector<HTMLElement>(`.floating-handle[data-id="${item.id}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (clientX < r.left || clientX > r.right) return
    const inGapY = handlePlacementOf(item) === 'top'
      ? clientY >= r.bottom && clientY <= r.bottom + HANDLE_GAP
      : clientY <= r.top && clientY >= r.top - HANDLE_GAP
    if (inGapY) hit = item.id
  })
  return hit
}

// 因拖拽栏 z（998）可能低于 itemZ 递增后的普通块、被背后块盖住时 e.target 落在背后块上
// closest('.drag-handle') 失效，故按坐标命中拖拽栏优先返回所属块，避免 hover 聚焦切到背后块
const hitHandleBar = (clientX: number, clientY: number): string | null => {
  let hit: string | null = null
  state.items.forEach((item) => {
    if (!state.selectedIds.has(item.id)) return
    const el = document.querySelector<HTMLElement>(`.floating-handle[data-id="${item.id}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) hit = item.id
  })
  return hit
}

// 因设置栏是块外浮层、可能盖在背后块矩形上（e.target 或被高 z 普通块盖住），
// 故按坐标命中设置栏时标记，避免 hover 聚焦切到背后块
const hitSettingsBar = (clientX: number, clientY: number): boolean => {
  for (const item of state.items) {
    if (!state.selectedIds.has(item.id)) continue
    const el = document.querySelector<HTMLElement>(`.side-settings[data-id="${item.id}"]`)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return true
  }
  return false
}

// 因手柄提升到顶层、可能被别的块矩形框覆盖，故鼠标悬停在某块的拖拽栏上时按该栏所属块判定，不被重叠矩形抢判
const hitTestBlockAt = (e: MouseEvent): string | null => {
  const target = e.target as HTMLElement
  // 因设置栏是块外浮层（可能盖在背后块矩形上），鼠标悬停其上不聚焦背后的块
  if (target.closest('.side-settings') || hitSettingsBar(e.clientX, e.clientY)) return null
  const handleEl = target.closest<HTMLElement>('.drag-handle')
  if (handleEl?.dataset.id) return handleEl.dataset.id
  const { clientX, clientY } = e
  const barHit = hitHandleBar(clientX, clientY)
  if (barHit) return barHit
  const gapHit = hitHandleGap(clientX, clientY)
  if (gapHit) return gapHit
  let hitId: string | null = null
  let hitZ = -Infinity
  state.items.forEach((item) => {
    const el = document.querySelector<HTMLElement>(`.drag-wrapper[data-id="${item.id}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return
    const z = itemZ(item.id)
    if (z > hitZ) {
      hitZ = z
      hitId = item.id
    }
  })
  return hitId
}

// 因需"鼠标在哪个块上就聚焦哪个块"（白板式 hover 选中），
// 故画布 mousemove 时按坐标命中块并单选；框选/拖拽/修饰键/已多选时不抢选中
let lastHoverId: string | null = null
const hoverFocusBlock = (e: MouseEvent) => {
  if (!isEditMode.value || e.button !== 0) return
  if (selectionState.active || customDrag.active) return
  // 因 resize 拖动手柄时鼠标会扫过其他块，若按悬停切选中会令被拖块失活、手柄消失，故 resize 期间不抢选中
  if (resizeSession) return
  if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
  if (state.selectedIds.size > 1) return
  const id = hitTestBlockAt(e)
  if (id === lastHoverId) return
  lastHoverId = id
  if (!id || !state.items.some((i) => i.id === id)) return
  state.selectedIds = new Set([id])
  focusBlockContent(id)
}

const finishSelection = () => {
  if (!selectionState.active) return
  selectionState.active = false
  stopAutoPan() // 框选结束停止边缘自动滚动
  const rect = selectionBox.value
  if (rect) {
    const matchedIds = state.items.filter((item) => isRectIntersectingItem(rect, item)).map((item) => item.id)
    if (selectionState.extend) {
      const next = new Set(state.selectedIds)
      matchedIds.forEach((id) => next.add(id))
      state.selectedIds = next
    } else {
      state.selectedIds = new Set(matchedIds)
    }
  } else if (!selectionState.extend) {
    state.selectedIds = new Set()
  }
  selectionState.justFinishedSelection = true
  selectionBox.value = null
}

const handleCanvasClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (selectionState.justFinishedSelection) {
    selectionState.justFinishedSelection = false
    return
  }
  if (target.closest('.drag-wrapper')) return
  state.selectedIds = new Set()
}

const handleCanvasFocusin = (e: FocusEvent) => {
  const target = e.target as HTMLElement
  const wrapper = target.closest<HTMLElement>('.drag-wrapper')
  if (!wrapper) return
  const id = wrapper.dataset.id
  if (!id || !state.items.some((i) => i.id === id)) return
  if (isEditMode.value) {
    handleSelect(id)
  }
  bringToTop(id)
}

// 因各组件内部数据需统一同步回 item.config，故经组件自定义的 saveConfig 接口收集
const syncComponentData = () => {
  state.items.forEach((item) => {
    const inst = componentRefs.value[item.id]
    const saved = inst?.saveConfig?.()
    if (saved) {
      item.config = { ...item.config, ...saved } as WidgetConfig
    }
  })
}

const generateId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const ARRANGE_GAP = 16
const ARRANGE_TOP = 16
const ARRANGE_LEFT = 16

const updateCanvasWidth = () => {
  const container = canvasContainerRef.value ?? canvasRef.value
  if (container) {
    canvasWidth.value = container.clientWidth
  }
}

const stretchMobileWidth = (item: CanvasItem) => {
  const mobile = item.layout.mobile
  mobile.x = 0
  mobile.w = canvasWidth.value
}

const applyMobileLayout = () => {
  if (!mobileMode.value || canvasWidth.value <= 0) return
  state.items.forEach(item => {
    stretchMobileWidth(item)
    const { desktop, mobile } = item.layout
    // 因旧数据可能缺失移动端位置/高度，故从桌面布局补齐
    if (mobile.y == null) mobile.y = desktop.y
    if (mobile.h == null) mobile.h = desktop.h
  })
}

const refreshLayout = () => {
  updateCanvasWidth()
  if (mobileMode.value) applyMobileLayout()
}

// 因需在组件重挂载前先同步富文本内容，故用 flush: 'pre'
watch(mobileMode, () => {
  syncComponentData()
  if (mobileMode.value) {
    // 因移动端锁水平，故将水平原点偏移并入桌面布局并归零，切换回桌面时位置不变、无感
    if (origin.x) {
      state.items.forEach((it) => { it.layout.desktop.x += origin.x })
      origin.x = 0
    }
    // 因移动端禁用缩放（布局按视口宽度拉伸），故切换时归零缩放
    zoom.value = 1
  }
  // 因移动端浏览滚动残留的 pan.y 会把另一布局画布顶出视口（块跑到视口外），故切换时归零平移（与 load 一致）
  pan.x = 0
  pan.y = 0
  // 首次进入该端：尚未排好的块自动布局（移动端纵向堆叠 / 桌面端瀑布流平铺）
  autoArrange(mobileMode.value ? 'mobile' : 'desktop')
  nextTick(refreshLayout)
}, { flush: 'pre' })

// 因删除块（任意入口）后其曲别针链接失效，故随 items 变化自动清理引用已不存在块的链接
watch(
  () => state.items.map((it) => it.id),
  (ids) => {
    const idSet = new Set(ids)
    linkedPairs.value = new Set(
      Array.from(linkedPairs.value).filter((k) => k.split('|').every((id) => idSet.has(id)))
    )
  }
)

const onResize = () => refreshLayout()

// 移动端自动布局：未排的块按桌面端阅读顺序纵向堆叠在已排块下方（x 恒 0，宽度由 applyMobileLayout 拉伸）
const autoArrangeMobile = () => {
  const pending = state.items.filter((it) => !it.arranged.mobile)
  if (pending.length === 0) return
  let cursor = ARRANGE_TOP
  state.items.forEach((it) => {
    if (it.arranged.mobile) cursor = Math.max(cursor, it.layout.mobile.y + it.layout.mobile.h)
  })
  pending
    .sort((a, b) => a.layout.desktop.y - b.layout.desktop.y)
    .forEach((it) => {
      const m = it.layout.mobile
      m.x = 0
      m.h = m.h > 0 ? m.h : it.layout.desktop.h
      m.y = Math.round(cursor + ARRANGE_GAP)
      cursor = m.y + m.h
      it.arranged.mobile = true
    })
}

// 桌面端自动布局：未排的块按视口宽度瀑布流平铺在已排块下方，避免互相重叠
const autoArrangeDesktop = () => {
  const pending = state.items.filter((it) => !it.arranged.desktop)
  if (pending.length === 0) return
  let cursorY = ARRANGE_TOP
  state.items.forEach((it) => {
    if (it.arranged.desktop) cursorY = Math.max(cursorY, it.layout.desktop.y + it.layout.desktop.h)
  })
  // 视口宽是像素，content 坐标比较需除 zoom（同 freeSpotFor）
  const maxX = Math.max(canvasWidth.value / zoom.value, ARRANGE_LEFT * 2)
  let cursorX = ARRANGE_LEFT
  let rowH = 0
  pending
    .sort((a, b) => a.layout.desktop.y - b.layout.desktop.y)
    .forEach((it) => {
      const d = it.layout.desktop
      if (cursorX + d.w > maxX - ARRANGE_LEFT) {
        cursorX = ARRANGE_LEFT
        cursorY += rowH + ARRANGE_GAP
        rowH = 0
      }
      d.x = cursorX
      d.y = Math.round(cursorY)
      cursorX += d.w + ARRANGE_GAP
      rowH = Math.max(rowH, d.h)
      it.arranged.desktop = true
    })
}

const autoArrange = (mode: 'desktop' | 'mobile') => {
  if (mode === 'mobile') autoArrangeMobile()
  else autoArrangeDesktop()
}

// 新块落位：桌面端从视口顶部与各已放块底部（贴底）挑候选顶边，视口内从左到右找不重叠空位；
// 因固定行距网格扫描会与既有块错位产生大空隙（窄视口每行一块时更明显），故改贴底候选保证紧凑；
// 移动端纵向堆叠，追加到列表末尾
const freeSpotFor = (w: number, h: number): { x: number; y: number } => {
  if (mobileMode.value) {
    let maxBottom = 0
    state.items.forEach((it) => {
      maxBottom = Math.max(maxBottom, it.layout.mobile.y + it.layout.mobile.h)
    })
    return { x: 0, y: Math.round(maxBottom + ARRANGE_GAP) }
  }
  const placed = state.items.map((it) => layoutOf(it))
  // 视口左上角对应的存储坐标（屏幕 = 存储*zoom + origin + pan），视口顶部作为首个候选保证新块可见；
  // 视口宽 canvasWidth 是像素，换算成 content 宽度需除 zoom，否则 zoom≠1 时换行边界错位（放大时新块被放到视口外）
  const vx = Math.round(-(origin.x + pan.x) / zoom.value)
  const vy = Math.round(-(origin.y + pan.y) / zoom.value)
  const viewW = Math.max(canvasWidth.value / zoom.value, ARRANGE_LEFT * 2)
  // 因视口基准 vx 随 panToBlock 居中漂移，若以其为 x 起点，连续添加的块会在 content 坐标逐次左偏（水平错位），
  // 故 x 起点对齐既有块最左 x（无块时用视口左），保证同列块左边缘对齐
  const leftBase = placed.length ? Math.min(...placed.map((p) => p.x)) : vx + ARRANGE_LEFT
  // 候选顶边：有块时只取各块底部贴底（避免 zoom<1 时"视口顶"远离已有块导致竖向间距骤增），无块时用视口顶
  const candidateYs = placed.length
    ? placed.map((p) => p.y + p.h + ARRANGE_GAP).sort((a, b) => a - b)
    : [vy + ARRANGE_TOP]
  for (const cy of candidateYs) {
    let cursorX = leftBase
    while (cursorX + w <= leftBase + viewW - ARRANGE_LEFT) {
      const overlap = placed.some((p) => cursorX < p.x + p.w && cursorX + w > p.x && cy < p.y + p.h && cy + h > p.y)
      if (!overlap) return { x: Math.round(cursorX), y: Math.round(cy) }
      cursorX += w + ARRANGE_GAP
    }
  }
  const maxBottom = state.items.reduce((m, it) => Math.max(m, layoutOf(it).y + layoutOf(it).h), vy)
  return { x: leftBase, y: Math.round(maxBottom + ARRANGE_GAP) }
}

// 把视角平移到指定块：让块中心落在视口中心。
// 因屏幕位置 = 存储坐标*zoom + origin + pan（canvas 只 translate），故反解 pan；移动端锁水平只调 y
const panToBlock = (id: string) => {
  const item = state.items.find((it) => it.id === id)
  if (!item) return
  const layout = layoutOf(item)
  const cont = canvasContainerRef.value
  const vw = cont?.clientWidth ?? window.innerWidth
  const vh = cont?.clientHeight ?? window.innerHeight
  const cx = (layout.x + layout.w / 2) * zoom.value
  const cy = (layout.y + layout.h / 2) * zoom.value
  if (!mobileMode.value) pan.x = Math.round(vw / 2 - origin.x - cx)
  pan.y = Math.round(vh / 2 - origin.y - cy)
}

const addComponent = (key: CanvasItem['component']) => {
  const meta = componentMetaOf(key)
  if (!meta) return
  const id = generateId()
  const { x, y } = freeSpotFor(meta.defaultSize.w, meta.defaultSize.h)
  const newItem: CanvasItem = {
    id,
    component: key,
    config: meta.defaultConfig(),
    layout: {
      desktop: { x, y, ...meta.defaultSize },
      // 因移动端宽度运行时拉伸（x 恒 0），故此处仅占位，首次进移动端时自动纵向堆叠
      mobile: { x: 0, y, ...meta.defaultSize },
    },
    // 当前端已落位；另一端留待首次进入时自动布局
    arranged: { desktop: !mobileMode.value, mobile: mobileMode.value },
  }
  state.items.push(newItem)
  if (mobileMode.value && canvasWidth.value > 0) {
    stretchMobileWidth(newItem)
  }
  // 因新块可能落在视口外（移动端追加到列表末尾、桌面端视口已满时兜底放块群下方），
  // 故添加后平移视角到新块，使其在视口内居中可见
  panToBlock(newItem.id)
}

const save = () => {
  syncComponentData()
  // 因块坐标需保持小值避免数据溢出，故以块群包围盒中心为新原点保存相对坐标，
  // 并用 origin 记录原点，加载时还原（视觉不变）
  const absOf = (r: Rect) => ({ x: r.x + origin.x + pan.x, y: r.y + origin.y + pan.y })
  let cx = 0, cy = 0
  if (state.items.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    state.items.forEach((it) => {
      const a = absOf(it.layout.desktop)
      if (a.x < minX) minX = a.x
      if (a.y < minY) minY = a.y
      if (a.x > maxX) maxX = a.x
      if (a.y > maxY) maxY = a.y
    })
    cx = Math.round((minX + maxX) / 2)
    cy = Math.round((minY + maxY) / 2)
  }
  const toSaveRect = (r: Rect) => ({
    // 因加载后块坐标需为整数（打开即清晰），故保存时取整
    x: Math.round(r.x + origin.x + pan.x - cx),
    y: Math.round(r.y + origin.y + pan.y - cy),
    w: Math.round(r.w),
    h: Math.round(r.h),
  })
  // 因移动端宽度运行时按画布拉伸，故不持久化，只存位置与高度
  const serializable = state.items.map((it) => ({
    id: it.id,
    component: it.component,
    config: it.config,
    layout: {
      desktop: toSaveRect(it.layout.desktop),
      mobile: { x: 0, y: Math.round(it.layout.mobile.y + origin.y + pan.y - cy), h: Math.round(it.layout.mobile.h) },
    },
    arranged: { ...it.arranged },
  }))
  return JSON.stringify({ origin: { x: cx, y: cy }, items: serializable, links: Array.from(linkedPairs.value) })
}

// 因需兼容「双端布局」重构（commit 7c65209）前的扁平格式并对缺失字段兜底，
// 故归一化加载条目，避免旧数据崩溃
const normalizeLoadedItem = (it: any): CanvasItem => {
  const component: CanvasItem['component'] = componentMap[it.component as CanvasItem['component']]
    ? (it.component as CanvasItem['component'])
    : 'RichTextEditor'
  const isLegacyFlat = !it.layout && typeof it.x === 'number' && typeof it.y === 'number'
  const desktop: Rect = isLegacyFlat
    ? { x: it.x, y: it.y, w: it.w ?? 400, h: it.h ?? 300 }
    : { x: 0, y: 0, w: 400, h: 300, ...(it.layout?.desktop ?? {}) }
  const mobile: Rect = { ...desktop, ...(it.layout?.mobile ?? {}) }
  // 因坐标异常（null/undefined）会使块被弄丢，故一律归 0
  desktop.x = typeof desktop.x === 'number' ? desktop.x : 0
  desktop.y = typeof desktop.y === 'number' ? desktop.y : 0
  mobile.x = typeof mobile.x === 'number' ? mobile.x : 0
  mobile.y = typeof mobile.y === 'number' ? mobile.y : 0
  // arranged：新数据读持久化标志；旧数据无该字段时，desktop 视为已排（保存的主布局），
  // mobile 若与 desktop 完全一致（纯副本）则视为未排，首次进移动端自动纵向堆叠
  let arranged = { desktop: true, mobile: true }
  if (it.arranged && typeof it.arranged === 'object') {
    arranged = {
      desktop: it.arranged.desktop !== false,
      mobile: it.arranged.mobile !== false,
    }
  } else {
    const savedMobile = it.layout?.mobile
    const mobileIsCopy = !savedMobile || (savedMobile.y === desktop.y && savedMobile.h === desktop.h)
    arranged = { desktop: true, mobile: !mobileIsCopy }
  }
  return {
    id: typeof it.id === 'string' && it.id ? it.id : generateId(),
    component,
    config: (it.config ?? componentMetaOf(component)?.defaultConfig() ?? {}) as WidgetConfig,
    layout: { desktop, mobile },
    arranged,
  }
}

const load = async (raw: string) => {
  if (!raw) return
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return // 数据损坏：静默跳过，不阻塞画布
  }
  // 因需兼容旧格式（数组 / { pan, items } / { origin, items }），故分别处理
  if (Array.isArray(parsed)) {
    state.items = parsed.map(normalizeLoadedItem)
    origin.x = 0
    origin.y = 0
  } else if (parsed && Array.isArray(parsed.items)) {
    state.items = parsed.items.map(normalizeLoadedItem)
    // 因新版以 origin 还原视觉位置，故加载之；旧数据无 origin 则归零
    origin.x = typeof parsed.origin?.x === 'number' ? parsed.origin.x : 0
    origin.y = typeof parsed.origin?.y === 'number' ? parsed.origin.y : 0
  } else {
    return
  }
  // 因保存坐标相对 origin 归一化，故加载后归零平移、从原点查看内容
  pan.x = 0
  pan.y = 0
  // 因曲别针粘贴链接需随文档持久化，故从保存数据恢复（watcher 会过滤引用已不存在块的链接）
  linkedPairs.value = new Set(
    Array.isArray(parsed.links) ? parsed.links.filter((k: unknown) => typeof k === 'string') : []
  )
  await nextTick()
  await nextTick()
  if (mobileMode.value) {
    // 因移动端块贴左（x 恒 0）而屏幕位置 = 存储坐标 + origin + pan，
    // 故加载时 origin.x 非 0 会把块水平顶出屏外；并入 desktop.x 并归零（与模式切换 watch 一致）
    if (origin.x) {
      state.items.forEach((it) => { it.layout.desktop.x += origin.x })
      origin.x = 0
    }
    updateCanvasWidth()
    applyMobileLayout()
  }
  // 首次加载即处于某端（如窄屏直启移动端）时，未排的块也自动布局
  autoArrange(mobileMode.value ? 'mobile' : 'desktop')
  state.items.forEach((item) => {
    componentRefs.value[item.id]?.loadConfig?.(item.config)
  })
}

const batchToggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  Array.from(state.selectedIds).forEach((id) => {
    componentRefs.value[id]?.commands?.toggleHeading?.({ level })
  })
}

const deleteSelected = () => {
  if (state.selectedIds.size === 0) return
  const ids = Array.from(state.selectedIds)
  state.items = state.items.filter((it) => !ids.includes(it.id))
  state.selectedIds = new Set()
  ids.forEach(id => { delete componentRefs.value[id] })
}

// 因拖拽/框选/平移收尾依赖 window mouseup，鼠标拖出窗口或失焦时 mouseup 丢失、
// 会话残留会致右键平移被守卫永久禁用，故失焦/指针取消时统一重置残留会话（各收尾函数自带条件守卫）
const abortSessions = () => {
  if (customDrag.active) onCustomDragUp()
  if (selectionState.active) finishSelection()
  if (panSession.active) stopPan()
  leftButtonDown = false
}

onMounted(() => {
  nextTick(refreshLayout)
  // 因整个视口（含负坐标区域、世界层外区域）右键拖拽都需平移，故捕获监听挂在视口容器上
  canvasContainerRef.value?.addEventListener('mousedown', handleCanvasMouseDownCapture, true)
  window.addEventListener('mousedown', onGlobalMouseDownCapture, true)
  window.addEventListener('mousedown', trackLeftButtonDown, true)
  window.addEventListener('mouseup', trackLeftButtonUp, true)
  window.addEventListener('resize', onResize)
  // 因编辑器（ProseMirror）内部会冒泡拦截 mousemove，故平移/框选/鼠标位置监听须用捕获阶段才能在内部拦截前执行
  window.addEventListener('mousemove', updateSelection, true)
  window.addEventListener('mouseup', finishSelection)
  window.addEventListener('mousemove', updatePan, true)
  window.addEventListener('mouseup', stopPan)
  window.addEventListener('contextmenu', preventContextMenu)
  window.addEventListener('mousemove', updateMousePos, true)
  window.addEventListener('omnijot:canvas-pan', onCanvasPanEvent)
  window.addEventListener('omnijot:block-popup', onBlockPopupChange)
  window.addEventListener('omnijot:block-popup-top', onBlockPopupTopChange)
  window.addEventListener('omnijot:auto-height', onAutoHeight)
  // 因 mouseup 丢失时需及时兜底重置会话，故挂失焦/指针取消兜底
  window.addEventListener('blur', abortSessions)
  window.addEventListener('pointercancel', abortSessions)
})

onUnmounted(() => {
  canvasContainerRef.value?.removeEventListener('mousedown', handleCanvasMouseDownCapture, true)
  window.removeEventListener('mousedown', onGlobalMouseDownCapture, true)
  window.removeEventListener('mousedown', trackLeftButtonDown, true)
  window.removeEventListener('mouseup', trackLeftButtonUp, true)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', updateSelection, true)
  window.removeEventListener('mouseup', finishSelection)
  window.removeEventListener('mousemove', updatePan, true)
  window.removeEventListener('mouseup', stopPan)
  window.removeEventListener('contextmenu', preventContextMenu)
  window.removeEventListener('mousemove', updateMousePos, true)
  window.removeEventListener('omnijot:canvas-pan', onCanvasPanEvent)
  window.removeEventListener('omnijot:block-popup', onBlockPopupChange)
  window.removeEventListener('omnijot:block-popup-top', onBlockPopupTopChange)
  window.removeEventListener('omnijot:auto-height', onAutoHeight)
  window.removeEventListener('blur', abortSessions)
  window.removeEventListener('pointercancel', abortSessions)
})

defineExpose({
  state,
  pan,
  origin,
  zoom,
  mobileMode,
  isPanning,
  canvasStyle,
  containerStyle,
  selectionBoxStyle,
  ADDABLE_COMPONENTS,
  isEditMode,
  forceMobile,
  componentRefs,
  nextForceMobile,
  syncComponentData,
  layoutOf,
  handlePlacementOf,
  handleBarStyle,
  getComponentProps,
  updateCode,
  updateLanguage,
  setComponentRef,
  addComponent,
  save,
  load,
  rebaseOrigin,
  batchToggleHeading,
  deleteSelected,
  compensateResizeAutoPan,
})
</script>

<style scoped>
.canvas-container {
  flex: 1;
  /* 因 flex item 默认 min-height:auto 会被内容撑到大于剩余空间，导致溢出 v-main 出现竖向滚动条，
     故允许收缩填满剩余（画布内容由 overflow:hidden 裁剪，无需撑高容器） */
  min-height: 0;
  position: relative;
  overflow: hidden;
  background-color: rgb(var(--v-theme-surface));
}

/* 因点阵背景需随 pan 合成移动且不露白，层仅比容器大一圈（transform 最多移一个 tile）；pointer-events 穿透不挡交互 */
.canvas-dots {
  position: absolute;
  top: -24px;
  left: -24px;
  right: -24px;
  bottom: -24px;
  background-image: radial-gradient(circle, rgba(var(--v-theme-on-surface), 0.15) 1px, transparent 1px);
  background-repeat: repeat;
  background-size: 24px 24px;
  pointer-events: none;
}

/* 因块用世界坐标定位可溢出层外，故超出视口的部分由容器 overflow hidden 裁剪；
   因平移无界，故点阵背景固定在视口容器上以保证背景始终存在 */
.canvas {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  cursor: grab;
  will-change: transform;
}

.canvas.panning {
  cursor: grabbing;
  user-select: none;
}

.selection-box {
  position: absolute;
  /* 因 --v-theme-primary 为 RGB 分量，直接作 border 颜色无效（虚线不显示），故用 rgb() 包裹 */
  border: 1px dashed rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  pointer-events: none;
  z-index: 55;
}

.drag-wrapper :deep(.handle) {
  z-index: 20;
}

/* 因选中描边环改为独立 overlay 渲染（需绘制在拖拽栏/缩放手柄之上、保持连贯），
   故块自身不再挂 box-shadow；overlay 用 2px 主题色实线描边
   （--v-theme-primary 为 RGB 分量，需经 rgb() 包裹才能用于 border） */
.selected-outline {
  position: absolute;
  border: 2px solid rgb(var(--v-theme-primary));
  pointer-events: none;
  /* 因描边环需绘制在拖拽栏之上、又在缩放手柄之下，故置 Z_LAYER.outline（999） */
  z-index: 999;
  box-sizing: border-box;
}

/* 曲别针：表面色圆底 + 描边 + 阴影使其在画布/块边缘清晰可辨；
   已粘贴为主题色实底白图标（醒目），未粘贴灰色图标（可见但示意未连接） */
.snap-paperclip {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  /* 因曲别针需显示在选中描边环与大小手柄之上，故置 Z_LAYER.paperclip（1003，连接点曲别针优先） */
  z-index: 1003;
  user-select: none;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.22);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  color: rgba(var(--v-theme-primary), 0.95);
  transition: background 0.12s, color 0.12s, transform 0.12s;
}
.snap-paperclip:hover {
  transform: translate(-50%, -50%) scale(1.15);
}
.snap-paperclip:not(.linked) {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.snap-paperclip.linked {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

/* 因行高亮 popup 弹出时块顶部正中间缩放手柄（.handle-tm）会插在 popup 上方，
   故仅在 popup 弹出时隐藏该块 tm（VDR 用内联 display 控制手柄显隐，故需 !important 覆盖） */
.drag-wrapper.popup-open :deep(.handle-tm) {
  display: none !important;
}

.block-container {
  height: 100%;
  width: 100%;
  position: relative;
  overflow: visible;
  background: rgb(var(--v-theme-surface));
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

/* 因手柄提升到 .canvas 顶层（脱离块内层叠上下文），
   故覆盖 .drag-handle/.right-handle 的块内定位（bottom:100% 等）以纯 top/left 定位 */
.floating-handle {
  position: absolute;
  bottom: auto;
  z-index: 999;
}

/* 因 handle 出现时播放 pop-up 滑出动画，若动画未完成即开始拖拽，
   其 transform 会把 handle 顶离块上方固定位（handleBarStyle 的 -30px），导致与鼠标分离；
   故拖拽期间（startCustomDrag 已加 body 类）禁用动画并立即归位，使 handle 跟住鼠标 */
body.block-handle-dragging .floating-handle {
  transition: none !important;
  transform: none !important;
}

.drag-handle {
  position: absolute;
  height: 28px;
  display: flex;
  align-items: center;
  cursor: grab;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  z-index: 16;
  padding: 0 10px;
  white-space: nowrap;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.2s;
  /* 贴边 ±1px 微调由内联 --handle-y 变量提供（替代原内联 transform） */
  transform: translateY(var(--handle-y, -1px));
}

.drag-handle.handle-bottom {
  border-top: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 0 0 4px 4px;
}

.drag-handle:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
}

.side-settings {
  position: absolute;
  height: 28px;
  display: flex;
  align-items: center;
  cursor: grab;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  z-index: 16;
  padding: 0 4px;
  white-space: nowrap;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.2s;
  /* 贴边 ±1px 微调由内联 --handle-y 变量提供（替代原内联 transform） */
  transform: translateY(var(--handle-y, -1px));
}
.side-settings.handle-bottom {
  border-top: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 0 0 4px 4px;
}
.side-settings :deep(.v-btn) {
  height: 18px;
  width: 18px;
  min-width: 18px;
}

/* 因菜单 teleport 到 body，v-list-item__content 默认 overflow:hidden 会裁掉 switch
   滑块（thumb）左侧扩散的阴影，故对该菜单放开裁剪让阴影完整显示 */
:global(.auto-height-menu .v-list-item__content) {
  overflow: visible;
}

.left-handle {
  bottom: 100%;
  left: 10px;
}

.handle-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-left: 4px;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 4px;
  box-sizing: border-box;
  background-color: transparent;
  /* 因需盖住"从块内滑出"阶段的手柄（z-index:10）又不挡缩放手柄（.handle 的 z-index:20），
     故置于 z-index:15 */
  position: relative;
  z-index: 15;
}

.inner-component {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
}

.pop-up-enter-active,
.pop-up-leave-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 因 top/bottom 放置时滑出方向相反，故由 handleBarStyle 提供 --handle-slide 变量驱动动画 */
.pop-up-enter-from {
  opacity: 0;
  transform: translateY(calc(var(--handle-y, 0px) + var(--handle-slide, 28px)));
}

.pop-up-enter-to {
  opacity: 1;
  transform: translateY(var(--handle-y, 0px));
}

.pop-up-leave-from {
  opacity: 1;
  transform: translateY(var(--handle-y, 0px));
}

.pop-up-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--handle-y, 0px) + var(--handle-slide, 28px)));
}
</style>