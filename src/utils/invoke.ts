// SPDX-License-Identifier: MIT
import { invoke, isTauri, type InvokeArgs } from '@tauri-apps/api/core'

import { invokeLocalNoteCommand } from './localNoteStore'

// 网页端无 IPC，笔记文件命令改走 localStorage，便于不启桌面端调试功能
export async function invokeCommand<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (!isTauri()) return invokeLocalNoteCommand<T>(command, args)
  return invoke<T>(command, args)
}
