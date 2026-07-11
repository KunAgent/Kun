import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openWorkspacePathInEditor,
  revealWorkspacePathInFileManager
} from './open-workspace-path'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openWorkspacePathInEditor', () => {
  it('returns a failed result when the editor bridge is unavailable', async () => {
    vi.stubGlobal('window', {})

    await expect(openWorkspacePathInEditor({ path: '/tmp/demo.ts' })).resolves.toEqual({
      ok: false,
      message: 'Editor bridge is unavailable.'
    })
  })

  it('converts editor bridge rejections into failed results', async () => {
    const openEditorPath = vi.fn(async () => {
      throw new Error('editor launch failed')
    })
    vi.stubGlobal('window', { kunGui: { openEditorPath } })

    await expect(openWorkspacePathInEditor({ path: '/tmp/demo.ts' })).resolves.toEqual({
      ok: false,
      message: 'editor launch failed'
    })
  })
})

describe('revealWorkspacePathInFileManager', () => {
  it('opens the requested path with the platform file manager', async () => {
    const openEditorPath = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/workspace/notes.md',
      editorId: 'file-manager'
    }))
    vi.stubGlobal('window', { kunGui: { openEditorPath } })

    await expect(
      revealWorkspacePathInFileManager('/tmp/workspace/notes.md', '/tmp/workspace')
    ).resolves.toMatchObject({ ok: true })
    expect(openEditorPath).toHaveBeenCalledWith({
      path: '/tmp/workspace/notes.md',
      workspaceRoot: '/tmp/workspace',
      editorId: 'file-manager'
    })
  })

  it('returns a failed result when the bridge rejects the request', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        openEditorPath: vi.fn(async () => {
          throw new Error('reveal failed')
        })
      }
    })

    await expect(revealWorkspacePathInFileManager('/tmp/workspace')).resolves.toEqual({
      ok: false,
      message: 'reveal failed'
    })
  })
})
