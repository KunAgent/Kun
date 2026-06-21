import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileChangePayload, WorkspaceFileWatchResult } from '@shared/workspace-file'
import {
  prepareDesignPreviewFile,
  startDesignHtmlPreviewWatch
} from './design-preview-file'

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function createWatchApi(result: WorkspaceFileWatchResult | Promise<WorkspaceFileWatchResult>) {
  let handler: ((payload: WorkspaceFileChangePayload) => void) | null = null
  const off = vi.fn()
  const api = {
    watchWorkspaceFile: vi.fn(async () => result),
    unwatchWorkspaceFile: vi.fn(async () => true),
    onWorkspaceFileChanged: vi.fn((nextHandler: (payload: WorkspaceFileChangePayload) => void) => {
      handler = nextHandler
      return off
    })
  }
  return {
    api,
    off,
    emit: (payload: WorkspaceFileChangePayload) => handler?.(payload)
  }
}

describe('design preview file helpers', () => {
  it('creates a visible skeleton for a new HTML turn before sending', async () => {
    const writeWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/.kun-design/new/v1.html',
      savedAt: '2026-06-21T00:00:00.000Z'
    }))

    const result = await prepareDesignPreviewFile(
      '/workspace',
      '.kun-design/new/v1.html',
      undefined,
      { writeWorkspaceFile }
    )

    expect(result).toEqual({ ok: true, source: 'skeleton' })
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: '.kun-design/new/v1.html',
      workspaceRoot: '/workspace',
      content: expect.stringContaining('Generating design...')
    })
    const [payload] = writeWorkspaceFile.mock.calls[0] as unknown as [{ content: string }]
    expect(payload.content).toContain('.kun-design/new/v1.html')
  })

  it('copies the previous HTML version into an iteration preview file', async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/.kun-design/screen/v1.html',
      content: '<!doctype html><html><body>Previous</body></html>',
      size: 48,
      truncated: false
    }))
    const writeWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/.kun-design/screen/v2.html',
      savedAt: '2026-06-21T00:00:00.000Z'
    }))

    const result = await prepareDesignPreviewFile(
      '/workspace',
      '.kun-design/screen/v2.html',
      '.kun-design/screen/v1.html',
      { readWorkspaceFile, writeWorkspaceFile }
    )

    expect(result).toEqual({ ok: true, source: 'base' })
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      path: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace'
    })
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: '.kun-design/screen/v2.html',
      workspaceRoot: '/workspace',
      content: '<!doctype html><html><body>Previous</body></html>'
    })
  })

  it('increments preview revision when the watched HTML file changes', async () => {
    const { api, emit, off } = createWatchApi({
      ok: true,
      watchId: 'watch-1',
      path: '/workspace/.kun-design/screen/v1.html',
      content: '<html></html>',
      size: 13,
      truncated: false,
      startedAt: '2026-06-21T00:00:00.000Z'
    })
    const onRevision = vi.fn()
    const dispose = startDesignHtmlPreviewWatch({
      api,
      workspaceRoot: '/workspace',
      path: '.kun-design/screen/v1.html',
      onRevision,
      onError: vi.fn()
    })
    await flushPromises()

    emit({
      ok: true,
      watchId: 'watch-other',
      workspaceRoot: '/workspace',
      path: '/workspace/.kun-design/screen/v1.html',
      content: 'ignored',
      size: 7,
      truncated: false,
      changedAt: '2026-06-21T00:00:01.000Z'
    })
    emit({
      ok: true,
      watchId: 'watch-1',
      workspaceRoot: '/workspace',
      path: '/workspace/.kun-design/screen/v1.html',
      content: '<html><body>Changed</body></html>',
      size: 33,
      truncated: false,
      changedAt: '2026-06-21T00:00:02.000Z'
    })

    expect(onRevision).toHaveBeenCalledTimes(2)
    expect(onRevision).toHaveBeenNthCalledWith(1, 1)
    expect(onRevision).toHaveBeenNthCalledWith(2, 2)

    dispose()
    expect(off).toHaveBeenCalled()
    expect(api.unwatchWorkspaceFile).toHaveBeenCalledWith('watch-1')
  })
})
