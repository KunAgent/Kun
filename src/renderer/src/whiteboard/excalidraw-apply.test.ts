import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyExcalidrawScene } from './excalidraw-persistence'
import {
  applyOpenExcalidrawScene,
  clearExcalidrawApplyHandlersForTests,
  excalidrawApplyKey,
  registerExcalidrawApplyHandler,
  reloadAndExportExcalidrawScene
} from './excalidraw-apply'

const { exportToBlob } = vi.hoisted(() => ({
  exportToBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
}))

vi.mock('@excalidraw/excalidraw', () => ({ exportToBlob }))

afterEach(() => {
  clearExcalidrawApplyHandlersForTests()
  vi.unstubAllGlobals()
  exportToBlob.mockClear()
})

describe('excalidraw apply', () => {
  it('fails closed when the matching board is not open', async () => {
    await expect(applyOpenExcalidrawScene('/work', 'board-1', '.kun-whiteboards')).resolves.toMatchObject({
      ok: false,
      error: { code: 'EXCALIDRAW_BOARD_CLOSED' }
    })
  })

  it('reloads the canonical scene, exports PNG, and reports applied', async () => {
    const scene = {
      ...createEmptyExcalidrawScene(),
      elements: [{ id: 'auth_box', type: 'rectangle', isDeleted: false }]
    }
    const saveWorkspaceImageBytes = vi.fn(async () => ({
      ok: true as const,
      path: '/work/.kun-whiteboards/board-1/excalidraw.png',
      workspaceRelativePath: '.kun-whiteboards/board-1/excalidraw.png',
      createdAt: 't'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: 'x',
          content: JSON.stringify(scene),
          size: 1,
          mtimeMs: 1,
          truncated: false
        })),
        saveWorkspaceImageBytes
      }
    })
    const reloaded: string[] = []
    const unregister = registerExcalidrawApplyHandler(
      excalidrawApplyKey('/work', 'board-1', '.kun-whiteboards'),
      async () => reloadAndExportExcalidrawScene({
      workspaceRoot: '/work',
      identityId: 'board-1',
      baseDir: '.kun-whiteboards',
      onReload: (next) => {
        reloaded.push(String((next.elements[0] as { id?: string }).id))
      }
    }))
    const result = await applyOpenExcalidrawScene('/work', 'board-1', '.kun-whiteboards')
    unregister()
    expect(result).toEqual({
      ok: true,
      pngRelativePath: '.kun-whiteboards/board-1/excalidraw.png',
      pngByteSize: 3,
      elementCount: 1
    })
    expect(reloaded).toEqual(['auth_box'])
    expect(saveWorkspaceImageBytes).toHaveBeenCalledWith(expect.objectContaining({
      imageDirectory: '.kun-whiteboards/board-1',
      fileName: 'excalidraw.png'
    }))
    expect(exportToBlob).toHaveBeenCalledOnce()
  })

  it('rejects an empty canonical scene', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: 'x',
          content: JSON.stringify(createEmptyExcalidrawScene()),
          size: 1,
          mtimeMs: 1,
          truncated: false
        }))
      }
    })
    await expect(reloadAndExportExcalidrawScene({
      workspaceRoot: '/work',
      identityId: 'board-1',
      baseDir: '.kun-whiteboards',
      onReload: () => undefined
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'EXCALIDRAW_SCENE_EMPTY' }
    })
    expect(exportToBlob).not.toHaveBeenCalled()
  })
})
