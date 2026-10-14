import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi } from 'vitest'
import { projects, requireCode } from './routing.js'
import { agentAttachmentSources } from './agent-attachments.js'
import { remoteAttachmentContent } from './attachment-access.js'
import { versionedHistory } from './versioned-history.js'
import { WorkbenchDirectoryService } from '../workbench-bridge/directory.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { SessionStore } from '../ports/session-store.js'

describe('restricted remote history and projects', () => {
  it('includes a persisted empty project and projects beyond the former 1000-thread boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-remote-projects-'))
    try {
      const fresh = join(root, 'fresh'), old = join(root, 'old')
      await mkdir(fresh); await mkdir(old)
      const directory = WorkbenchDirectoryService.forDataDir(root)
      await directory.set({ codeProjects: [fresh], workRoots: [] })
      const listPage = vi.fn(async ({ cursor }: { cursor?: string }) => {
        const page = Number(cursor ?? 0)
        return { threads: Array.from({ length: 200 }, () => ({ workspace: page === 5 ? old : fresh, agentSurface: 'code' })),
          hasMore: page < 5, nextCursor: page < 5 ? String(page + 1) : undefined }
      })
      const runtime = { rooms: { workbench: { directory: WorkbenchDirectoryService.forDataDir(root) } },
        threadService: { listPage } } as unknown as ServerRuntime
      expect((await projects(runtime)).map(project => project.path).sort()).toEqual((await Promise.all([realpath(fresh), realpath(old)])).sort())
      expect(listPage).toHaveBeenCalledTimes(6)
      expect(listPage.mock.calls.every(([options]) => !('workspace' in options))).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fails closed on a non-advancing project cursor and distinguishes deleted Code tasks', async () => {
    const runtime = { threadService: {
      listPage: async () => ({ threads: [], hasMore: true, nextCursor: 'same' }), get: async () => null
    } } as unknown as ServerRuntime
    await expect(projects(runtime)).rejects.toThrow('PROJECT_DIRECTORY_UNAVAILABLE')
    await expect(requireCode(runtime, 'deleted')).rejects.toThrow('NOT_FOUND')
  })

  it('returns settled Agent attachment provenance only from the message-owning room', async () => {
    const runtime = {
      rooms: { deps: { store: { get: async () => ({ roomId: 'room', value: { sourceMessageId: 'message', threadId: 'settled' } }) } } },
      threadService: { get: async () => ({ id: 'settled', roomContext: { roomId: 'room' } }) }
    } as unknown as ServerRuntime
    const messages = [{ id: 'message', attachmentIds: ['file'], sourceRequestId: 'request' }] as RoomMessage[]
    expect((await agentAttachmentSources(runtime, 'room', messages))[0]).toMatchObject({ attachmentThreadId: 'settled' })
    expect((await agentAttachmentSources(runtime, 'another', messages))[0]).not.toHaveProperty('attachmentThreadId')
    runtime.threadService.get = vi.fn(async () => ({ id: 'settled', roomContext: { roomId: 'another' } })) as any
    expect((await agentAttachmentSources(runtime, 'room', messages))[0]).not.toHaveProperty('attachmentThreadId')
  })

  it('rejects same-workspace ADE and unbound files, but permits a proven legacy transcript reference', async () => {
    const resolveContent = vi.fn(async () => ({ data: Buffer.from('allowed') }))
    const runtime = {
      threadService: { get: async () => ({ id: 'code', workspace: '/shared', agentSurface: 'code' }) },
      attachmentStore: { get: async () => ({ threadIds: ['ade'], workspaces: ['/shared'] }), resolveContent },
      sessionStore: { loadItemPage: async () => ({ items: [], hasMore: false }) }
    } as unknown as ServerRuntime
    await expect(remoteAttachmentContent(runtime, 'code', 'file')).rejects.toThrow('FILE_NOT_ALLOWED')
    runtime.attachmentStore!.get = vi.fn(async () => ({ threadIds: [], workspaces: [] })) as any
    await expect(remoteAttachmentContent(runtime, 'code', 'file')).rejects.toThrow('FILE_NOT_ALLOWED')
    expect(resolveContent).not.toHaveBeenCalled()
    runtime.sessionStore.loadItemPage = vi.fn(async () => ({ items: [{ attachmentIds: ['file'] }], hasMore: false })) as any
    await expect(remoteAttachmentContent(runtime, 'code', 'file')).resolves.toMatchObject({ data: Buffer.from('allowed') })
  })

  it('retries a snapshot racing a rewrite and refuses a continuously changing history', async () => {
    let version = 'a', calls = 0
    const store = { itemHistoryVersion: async () => version } as unknown as SessionStore
    const result = await versionedHistory(store, 'thread', async () => { calls++; version = 'b'; return calls })
    expect(result).toEqual({ history: 2, historyVersion: 'b' })
    await expect(versionedHistory(store, 'thread', async () => { version += '!'; return 'unstable' })).rejects.toThrow('HISTORY_CHANGED')
  })
})
