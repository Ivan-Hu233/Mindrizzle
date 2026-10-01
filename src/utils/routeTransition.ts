// SPDX-License-Identifier: MIT
import { ref } from 'vue'

export type TransitionName =
  | 'VSlideXTransition'
  | 'VSlideXReverseTransition'
  | 'VFadeTransition'

// main.ts 要导 App.vue、App.vue 又要读过渡名，放一起会形成循环导入，故单独成模块
export const routeTransition = ref<TransitionName>('VFadeTransition')
