import { invoke, type InvokeArgs } from '@tauri-apps/api/core'

export async function invokeCommand<T>(command: string, args?: InvokeArgs): Promise<T> {
  return invoke<T>(command, args)
}
