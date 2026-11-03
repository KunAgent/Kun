import { useEffect, useState } from 'react'
import { WORK_WHITEBOARD_DIR } from '../write/work-whiteboard'
import { excalidrawPngPath, excalidrawScenePath, parseExcalidrawScene } from '../whiteboard/excalidraw-persistence'
import type { LibraryArtifact } from './artifact-types'

const cache = new Map<string, string>()
const CACHE_LIMIT = 40

function remember(key: string, url: string): string {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string
    const stale = cache.get(oldest)
    if (stale?.startsWith('blob:')) URL.revokeObjectURL(stale)
    cache.delete(oldest)
  }
  cache.set(key, url)
  return url
}

/**
 * A still image of a Work whiteboard: the PNG snapshot Excalidraw boards keep
 * beside their scene, or a fresh render of the scene when no snapshot exists.
 * Kun-engine boards have neither and resolve to an empty string.
 */
export async function loadBoardPreview(artifact: LibraryArtifact): Promise<string> {
  const boardId = artifact.whiteboardId
  const api = window.kunGui
  if (!boardId || !api) return ''
  const key = `${artifact.id}:${artifact.updatedAt}`
  const cached = cache.get(key)
  if (cached) return cached
  const png = await api.readWorkspaceImage?.({
    workspaceRoot: artifact.workspaceRoot,
    path: excalidrawPngPath(boardId, WORK_WHITEBOARD_DIR)
  }).catch(() => null)
  if (png?.ok) return remember(key, png.dataUrl)
  const raw = await api.readWorkspaceFile?.({
    workspaceRoot: artifact.workspaceRoot,
    path: excalidrawScenePath(boardId, WORK_WHITEBOARD_DIR)
  }).catch(() => null)
  const scene = raw?.ok && !raw.truncated ? parseExcalidrawScene(raw.content) : null
  const elements = scene?.elements.filter((element) =>
    Boolean(element) && typeof element === 'object' && (element as { isDeleted?: unknown }).isDeleted !== true) ?? []
  if (!scene || elements.length === 0) return ''
  const { exportToBlob } = await import('@excalidraw/excalidraw')
  const blob = await exportToBlob({
    elements: elements as never,
    appState: { ...(scene.appState ?? {}), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: '#ffffff' } as never,
    files: (scene.files ?? {}) as never,
    mimeType: 'image/png',
    exportPadding: 24
  })
  return remember(key, URL.createObjectURL(blob))
}

export function useBoardPreview(artifact: LibraryArtifact | null): { url: string; loading: boolean } {
  const [state, setState] = useState({ url: '', loading: Boolean(artifact?.whiteboardId) })
  useEffect(() => {
    if (!artifact?.whiteboardId) { setState({ url: '', loading: false }); return }
    let cancelled = false
    setState((current) => ({ url: current.url, loading: true }))
    void loadBoardPreview(artifact).catch(() => '').then((url) => {
      if (!cancelled) setState({ url, loading: false })
    })
    return () => { cancelled = true }
  }, [artifact])
  return state
}
