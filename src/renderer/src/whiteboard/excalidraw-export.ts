import { exportToBlob, exportToSvg } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

export type ExcalidrawBoardExportFormat = 'png' | 'svg'

function sceneForExport(api: ExcalidrawImperativeAPI) {
  const appState = api.getAppState()
  return {
    elements: api.getSceneElements(),
    files: api.getFiles(),
    appState: {
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: appState.viewBackgroundColor
    },
    exportPadding: 24
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the exported image.'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

async function renderBoard(
  api: ExcalidrawImperativeAPI,
  format: ExcalidrawBoardExportFormat
): Promise<Blob> {
  const scene = sceneForExport(api)
  if (scene.elements.length === 0) throw new Error('The whiteboard is empty.')
  if (format === 'png') return exportToBlob({ ...scene, mimeType: 'image/png' })
  const svg = await exportToSvg(scene)
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
}

/** Render the live board and hand it to the native save dialog. Resolves false when cancelled. */
export async function saveExcalidrawBoardAs(options: {
  api: ExcalidrawImperativeAPI
  format: ExcalidrawBoardExportFormat
  workspaceRoot: string
  suggestedName: string
}): Promise<boolean> {
  const blob = await renderBoard(options.api, options.format)
  const save = window.kunGui?.saveWorkspaceFileAs
  if (typeof save !== 'function') throw new Error('Saving files is unavailable.')
  const result = await save({
    workspaceRoot: options.workspaceRoot,
    suggestedName: `${options.suggestedName}.${options.format}`,
    dataBase64: await blobToBase64(blob),
    mimeType: blob.type
  })
  if (result.ok) return true
  if (result.canceled) return false
  throw new Error(result.message || 'Could not save the image.')
}

/** Copy the live board to the clipboard as a PNG. */
export async function copyExcalidrawBoardImage(api: ExcalidrawImperativeAPI): Promise<void> {
  const blob = await renderBoard(api, 'png')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
