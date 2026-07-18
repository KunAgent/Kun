import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openWorkspaceFileWithSystemDefault,
  openWorkspacePathInEditor,
  revealWorkspaceFileInFileManager,
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

describe('exact workspace file actions', () => {
  it('resolves the exact workspace file before using the system default application', async () => {
    const resolveWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/workspace/presentations/brief.pptx'
    }))
    const openEditorPath = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/workspace/presentations/brief.pptx',
      editorId: 'system'
    }))
    vi.stubGlobal('window', { kunGui: { resolveWorkspaceFile, openEditorPath } })

    await expect(
      openWorkspaceFileWithSystemDefault('presentations/brief.pptx', '/tmp/workspace')
    ).resolves.toMatchObject({ ok: true, editorId: 'system' })
    expect(resolveWorkspaceFile).toHaveBeenCalledWith({
      path: 'presentations/brief.pptx',
      workspaceRoot: '/tmp/workspace'
    })
    expect(openEditorPath).toHaveBeenCalledWith({
      path: '/tmp/workspace/presentations/brief.pptx',
      workspaceRoot: '/tmp/workspace',
      editorId: 'system',
      openPolicy: 'presentation-artifact'
    })
  })

  it('does not open a missing or ambiguous presentation', async () => {
    const openEditorPath = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        resolveWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'File not found.' })),
        openEditorPath
      }
    })

    await expect(
      openWorkspaceFileWithSystemDefault('brief.pptx', '/tmp/workspace')
    ).resolves.toEqual({ ok: false, message: 'File not found.' })
    expect(openEditorPath).not.toHaveBeenCalled()
  })

  it('resolves the same exact file before revealing it in the file manager', async () => {
    const openEditorPath = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/workspace/brief.kun-ppt.html',
      editorId: 'file-manager'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        resolveWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: '/tmp/workspace/brief.kun-ppt.html'
        })),
        openEditorPath
      }
    })

    await expect(
      revealWorkspaceFileInFileManager('brief.kun-ppt.html', '/tmp/workspace')
    ).resolves.toMatchObject({ ok: true, editorId: 'file-manager' })
    expect(openEditorPath).toHaveBeenCalledWith({
      path: '/tmp/workspace/brief.kun-ppt.html',
      workspaceRoot: '/tmp/workspace',
      editorId: 'file-manager',
      openPolicy: 'presentation-artifact'
    })
  })

  it('carries the trusted HTML digest into the system-open policy', async () => {
    const contentSha256 = 'a'.repeat(64)
    const openEditorPath = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/workspace/brief.kun-ppt.html',
      editorId: 'system'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        resolveWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: '/tmp/workspace/brief.kun-ppt.html'
        })),
        openEditorPath
      }
    })

    await expect(openWorkspaceFileWithSystemDefault(
      'brief.kun-ppt.html',
      '/tmp/workspace',
      contentSha256
    )).resolves.toMatchObject({ ok: true })
    expect(openEditorPath).toHaveBeenCalledWith({
      path: '/tmp/workspace/brief.kun-ppt.html',
      workspaceRoot: '/tmp/workspace',
      editorId: 'system',
      openPolicy: 'presentation-artifact',
      expectedSha256: contentSha256
    })
  })

  it('requires the owning workspace root', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        resolveWorkspaceFile: vi.fn(),
        openEditorPath: vi.fn()
      }
    })

    await expect(openWorkspaceFileWithSystemDefault('/tmp/brief.pptx', '')).resolves.toEqual({
      ok: false,
      message: 'Workspace root is required.'
    })
  })
})
