import {
  discardPendingExcalidrawScene,
  excalidrawPngPath,
  isExcalidrawSceneEmpty,
  loadExcalidrawScene,
  rememberLiveExcalidrawScene,
  type ExcalidrawSceneV1
} from './excalidraw-persistence'

export const DESIGN_APPLY_EXCALIDRAW_TOOL_NAME = 'design_apply_excalidraw'

export type ExcalidrawApplyError = {
  code: string
  message: string
  suggestion?: string
}

export type ExcalidrawApplySuccess = {
  ok: true
  pngRelativePath: string
  pngByteSize: number
  elementCount: number
}

export type ExcalidrawApplyFailure = {
  ok: false
  error: ExcalidrawApplyError
}

export type ExcalidrawApplyResult = ExcalidrawApplySuccess | ExcalidrawApplyFailure

export type ExcalidrawApplyHandler = () => Promise<ExcalidrawApplyResult>

const handlers = new Map<string, ExcalidrawApplyHandler>()
const claimedApplyBlockIds = new Set<string>()
const MAX_CLAIMED_APPLY_BLOCKS = 200

export function clearExcalidrawApplyHandlersForTests(): void {
  handlers.clear()
  claimedApplyBlockIds.clear()
}

/**
 * A mounted board surface and the workbench-level router both observe the
 * same accepted apply blocks. The first processor claims the block id so the
 * request is applied exactly once.
 */
export function claimExcalidrawApplyRequest(blockId: string): boolean {
  if (claimedApplyBlockIds.has(blockId)) return false
  if (claimedApplyBlockIds.size >= MAX_CLAIMED_APPLY_BLOCKS) {
    const oldest = claimedApplyBlockIds.values().next().value
    if (oldest !== undefined) claimedApplyBlockIds.delete(oldest)
  }
  claimedApplyBlockIds.add(blockId)
  return true
}

export function hasExcalidrawApplyHandler(key: string): boolean {
  return handlers.has(key)
}

export function hasAnyExcalidrawApplyHandler(workspaceRoot: string, baseDir: string): boolean {
  const prefix = `${workspaceRoot}\0${baseDir}\0`
  for (const key of handlers.keys()) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

export function excalidrawApplyKey(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): string {
  return [workspaceRoot, baseDir, identityId].join('\0')
}

export function registerExcalidrawApplyHandler(
  key: string,
  handler: ExcalidrawApplyHandler
): () => void {
  handlers.set(key, handler)
  return () => {
    if (handlers.get(key) === handler) handlers.delete(key)
  }
}

export async function applyOpenExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): Promise<ExcalidrawApplyResult> {
  const handler = handlers.get(excalidrawApplyKey(workspaceRoot, identityId, baseDir))
  if (!handler) {
    return {
      ok: false,
      error: {
        code: 'EXCALIDRAW_BOARD_CLOSED',
        message: 'The Excalidraw board is not open in the GUI.',
        suggestion: 'Open the matching Work, Design, or Code Excalidraw board and retry.'
      }
    }
  }
  return handler()
}

export async function reloadAndExportExcalidrawScene(input: {
  workspaceRoot: string
  identityId: string
  baseDir: string
  onReload: (scene: ExcalidrawSceneV1) => void
}): Promise<ExcalidrawApplyResult> {
  await discardPendingExcalidrawScene(input.workspaceRoot, input.identityId, input.baseDir)
  const scene = await loadExcalidrawScene(input.workspaceRoot, input.identityId, input.baseDir)
  if (!scene || isExcalidrawSceneEmpty(scene)) {
    return {
      ok: false,
      error: {
        code: 'EXCALIDRAW_SCENE_EMPTY',
        message: 'The canonical excalidraw.json is missing or has no live elements.',
        suggestion: 'Write the scene file first, then call design_apply_excalidraw.'
      }
    }
  }
  rememberLiveExcalidrawScene(input.workspaceRoot, input.identityId, input.baseDir, scene)
  input.onReload(scene)
  return exportExcalidrawPngSidecar({
    workspaceRoot: input.workspaceRoot,
    identityId: input.identityId,
    baseDir: input.baseDir,
    scene
  })
}

export async function exportExcalidrawPngSidecar(input: {
  workspaceRoot: string
  identityId: string
  baseDir: string
  scene: ExcalidrawSceneV1
}): Promise<ExcalidrawApplyResult> {
  const pngRelativePath = excalidrawPngPath(input.identityId, input.baseDir)
  const liveElements = input.scene.elements.filter((element) => {
    return Boolean(element) && typeof element === 'object' && !Array.isArray(element) &&
      (element as { isDeleted?: unknown }).isDeleted !== true
  })
  let blob: Blob
  try {
    const { exportToBlob } = await import('@excalidraw/excalidraw')
    blob = await exportToBlob({
      elements: liveElements as never,
      appState: {
        ...(input.scene.appState ?? {}),
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: typeof input.scene.appState?.viewBackgroundColor === 'string'
          ? input.scene.appState.viewBackgroundColor
          : '#ffffff'
      } as never,
      files: (input.scene.files ?? {}) as never,
      mimeType: 'image/png',
      exportPadding: 24
    })
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'EXCALIDRAW_PNG_EXPORT_FAILED',
        message: error instanceof Error ? error.message : String(error),
        suggestion: 'Retry design_apply_excalidraw after the board is visible.'
      }
    }
  }
  if (typeof window.kunGui?.saveWorkspaceImageBytes !== 'function') {
    return {
      ok: false,
      error: {
        code: 'EXCALIDRAW_PNG_UNAVAILABLE',
        message: 'Workspace image export is unavailable.',
        suggestion: 'Retry in the desktop app after the board is visible.'
      }
    }
  }
  const dataBase64 = await blobToBase64(blob)
  const directory = pngRelativePath.slice(0, pngRelativePath.lastIndexOf('/'))
  const saved = await window.kunGui.saveWorkspaceImageBytes({
    workspaceRoot: input.workspaceRoot,
    dataBase64,
    mimeType: 'image/png',
    imageDirectory: directory,
    fileName: 'excalidraw.png'
  })
  if (!saved.ok) {
    return {
      ok: false,
      error: {
        code: 'EXCALIDRAW_PNG_SAVE_FAILED',
        message: saved.message,
        suggestion: 'Check workspace write access and retry design_apply_excalidraw.'
      }
    }
  }
  if (saved.workspaceRelativePath !== pngRelativePath) {
    return {
      ok: false,
      error: {
        code: 'EXCALIDRAW_PNG_PATH_MISMATCH',
        message: 'The PNG sidecar was saved to an unexpected path.'
      }
    }
  }
  return {
    ok: true,
    pngRelativePath,
    pngByteSize: blob.size,
    elementCount: liveElements.length
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
