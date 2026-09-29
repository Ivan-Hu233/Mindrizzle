// SPDX-License-Identifier: MIT
// 网页端没有 Tauri IPC，笔记文件层退化为 localStorage：正文与元信息原样存 JSON，不做 tar/压缩
import type { InvokeArgs } from '@tauri-apps/api/core'

const FILE_INDEX_KEY = 'mindrizzle:file-index'
const NOTE_KEY_PREFIX = 'mindrizzle:note:'
const FILE_NAME_MAX_LEN = 50
const FILE_NAME_FORBIDDEN_CHARS = /[\\/:*?"<>|]/
// 与后端 resolve_mdrf_file_name 对齐：首字符不得空格，尾字符不得空格或点
const FILE_NAME_EDGE_CHARS = /^ |[ .]$/
const FILE_NAME_RESERVED = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]

export interface NoteMeta {
  title: string
  description: string
  tag: string[]
}

interface NoteRecord {
  meta: NoteMeta
  content: string
  updatedAt: number
}

type NoteCommandArgs = Record<string, unknown>

const noteKeyOf = (fileName: string): string => `${NOTE_KEY_PREFIX}${fileName}`

const readFileIndex = (): string[] => {
  const raw = localStorage.getItem(FILE_INDEX_KEY)
  return raw ? (JSON.parse(raw) as string[]) : []
}

const writeFileIndex = (fileNames: string[]): void => {
  localStorage.setItem(FILE_INDEX_KEY, JSON.stringify(fileNames))
}

const readNote = (fileName: string): NoteRecord | null => {
  const raw = localStorage.getItem(noteKeyOf(fileName))
  return raw ? (JSON.parse(raw) as NoteRecord) : null
}

const writeNote = (fileName: string, note: NoteRecord): void => {
  localStorage.setItem(noteKeyOf(fileName), JSON.stringify(note))
}

const padNumber = (value: number): string => String(value).padStart(2, '0')

const buildDefaultFileName = (): string => {
  const now = new Date()
  const date = [now.getFullYear(), padNumber(now.getMonth() + 1), padNumber(now.getDate())].join('-')
  const time = [padNumber(now.getHours()), padNumber(now.getMinutes()), padNumber(now.getSeconds())].join('-')
  return `我的笔记_${date}_${time}`
}

const resolveFileName = (fileName: string): string => {
  const resolved = fileName === '' ? buildDefaultFileName() : fileName
  if (resolved.length > FILE_NAME_MAX_LEN || FILE_NAME_EDGE_CHARS.test(resolved)) {
    throw new Error('文件名过长或首尾含非法字符')
  }
  if (FILE_NAME_FORBIDDEN_CHARS.test(resolved)) {
    throw new Error('文件名不能包含 \\ / : * ? " < > | 等字符')
  }
  if (FILE_NAME_RESERVED.includes(resolved.toUpperCase())) {
    throw new Error('文件名不能是系统保留设备名')
  }
  return resolved
}

const requireNote = (fileName: string): { resolved: string; note: NoteRecord } => {
  const resolved = resolveFileName(fileName)
  const note = readNote(resolved)
  if (!note) throw new Error('文件不存在或者是个目录')
  return { resolved, note }
}

const fetchFileList = (): string[] => readFileIndex()

// 后端只比对磁盘占用，故此处同样只看索引里是否已存在
const isFileNameValid = (fileName: string): boolean => !readFileIndex().includes(fileName)

const getFileMeta = (fileName: string): NoteMeta & { updatedAt: number } => {
  const { note } = requireNote(fileName)
  // 旧存档无 updatedAt，故容忍缺失
  return { ...note.meta, updatedAt: note.updatedAt ?? 0 }
}

const getFileBody = (fileName: string): { content: string } => ({
  content: requireNote(fileName).note.content,
})

const setFileBody = (fileName: string, content: string): void => {
  const { resolved, note } = requireNote(fileName)
  writeNote(resolved, { ...note, content, updatedAt: Date.now() })
}

const createFile = (meta: NoteMeta, fileName: string): string => {
  const resolved = resolveFileName(fileName)
  if (readNote(resolved)) throw new Error('同名文件已存在')
  writeNote(resolved, { meta, content: '', updatedAt: Date.now() })
  writeFileIndex([...readFileIndex(), resolved])
  return resolved
}

// 调试页清空测试存档用，只删除本模块写入的键
export const clearLocalNotes = (): void => {
  const noteKeys = Object.keys(localStorage).filter(
    (key) => key === FILE_INDEX_KEY || key.startsWith(NOTE_KEY_PREFIX),
  )
  noteKeys.forEach((key) => localStorage.removeItem(key))
}

const COMMAND_HANDLERS: Record<string, (args: NoteCommandArgs) => unknown> = {
  fetch_file_list: () => fetchFileList(),
  is_file_name_valid: (args) => isFileNameValid(String(args.fileName)),
  get_mdr_file_meta: (args) => getFileMeta(String(args.fileName)),
  get_mdr_file_body: (args) => getFileBody(String(args.fileName)),
  set_mdr_file_body: (args) => setFileBody(String(args.fileName), String(args.content)),
  create_mdr_file: (args) => createFile(args.mdrFileInfo as NoteMeta, String(args.fileName)),
}

export async function invokeLocalNoteCommand<T>(command: string, args?: InvokeArgs): Promise<T> {
  const handler = COMMAND_HANDLERS[command]
  if (!handler) throw new Error(`浏览器端未实现命令：${command}`)
  return handler(args as NoteCommandArgs) as T
}
