export const loadEditorComponent = () => import('../Views/Editor.vue')

export type EditorBodyResult = { content: string } | { error: unknown }

let pendingEditorBody: { fileName: string; bodyPromise: Promise<EditorBodyResult> } | null = null

export function storePendingEditorBody(fileName: string, bodyPromise: Promise<EditorBodyResult>) {
	pendingEditorBody = { fileName, bodyPromise }
}

export function takePendingEditorBody(fileName: string) {
	if (!pendingEditorBody || pendingEditorBody.fileName !== fileName) return null
	const bodyPromise = pendingEditorBody.bodyPromise
	pendingEditorBody = null
	return bodyPromise
}