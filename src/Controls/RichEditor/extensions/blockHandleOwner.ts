import { ref } from 'vue'

// 多选时 keepAlive 会让已激活 popup 残留、与鼠标所在块互相"折叠"，
// 用模块级共享状态仲裁：最后激活的块独占 owner，其余实例收到变化即收起自己
export const activeHandleBlockId = ref<string | null>(null)
