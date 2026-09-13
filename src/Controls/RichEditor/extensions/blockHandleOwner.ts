import { ref } from 'vue'

// 各块 block-handle 独立随 ProseKit hover 显隐，多选时 keepAlive 会让已激活 popup 残留、
// 与鼠标所在块的 popup 互相"折叠"，用模块级共享响应式状态仲裁"同一时刻只显示一个"：
// 最后激活的块独占 owner，其余实例收到 owner 变化即强制收起自己
export const activeHandleBlockId = ref<string | null>(null)
