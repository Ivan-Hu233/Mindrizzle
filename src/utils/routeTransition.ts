import { ref, type InjectionKey } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

export type TransitionName =
  | 'VSlideXTransition'
  | 'VSlideXReverseTransition'
  | 'VFadeTransition'

export interface NoteLoadController {
  setProgress(progress: number): void
  setName(name: string): void
  finish(): void
}

export type PrepareEditorNavigation = () => Promise<void>
export type StartEditorTransition = (target: RouteLocationRaw, prepare: PrepareEditorNavigation) => Promise<void>

export const noteLoadControllerKey: InjectionKey<NoteLoadController> = Symbol('noteLoadController')
export const startEditorTransitionKey: InjectionKey<StartEditorTransition> = Symbol('startEditorTransition')
export const isDebugLoadingEnabled = ref(false)

// main.ts 要导 App.vue、App.vue 又要读过渡名，放一起会形成循环导入，故单独成模块
export const routeTransition = ref<TransitionName>('VFadeTransition')
