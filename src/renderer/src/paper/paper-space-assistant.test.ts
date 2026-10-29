/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPaperSpaceAssistant } from './paper-space-assistant'

const mocked = vi.hoisted(() => ({
  create: vi.fn(), send: vi.fn(), upload: vi.fn(),
  chat: { route: 'papers', activeThreadId: 'work-thread', composerInput: 'Work draft', attachmentIds: ['work-image'] },
  paper: { readerKey: 'source-a/paper' }
}))
vi.mock('../store/chat-store', () => ({ useChatStore: {
  getState: () => ({ ...mocked.chat, createThread: mocked.create, sendMessage: mocked.send }),
  setState: (patch: Partial<typeof mocked.chat>) => Object.assign(mocked.chat, patch)
} }))
vi.mock('../agent/registry', () => ({ getProvider: () => ({ uploadAttachment: mocked.upload }) }))
vi.mock('./paper-space-store', () => ({ usePaperSpaceStore: { getState: () => mocked.paper } }))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocked.chat, { route: 'papers', activeThreadId: 'work-thread', composerInput: 'Work draft', attachmentIds: ['work-image'] })
  mocked.paper.readerKey = 'source-a/paper'
  mocked.create.mockImplementation(async () => { mocked.chat.activeThreadId = 'paper-thread'; return 'paper-thread' })
  mocked.send.mockResolvedValue(true)
  mocked.upload.mockResolvedValue({ id: 'paper-image', name: 'figure.png', mimeType: 'image/png' })
})

describe('paper assistant source and thread isolation', () => {
  it('creates an independent thread rooted in the paper source, never sends Work composer state', async () => {
    await expect(openPaperSpaceAssistant({ workspaceRoot: '/legacy', unitDir: 'papers/a', title: 'Paper A', prompt: 'Explain this paper' }))
      .resolves.toBe('paper-thread')
    expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/legacy', forceNew: true, useWorktreePool: false, activationGuard: expect.any(Function)
    }))
    expect(mocked.send).toHaveBeenCalledWith('Explain this paper', 'agent', {
      expectedThreadId: 'paper-thread', agentSurface: 'code', attachmentIds: [], attachments: [], composerContexts: [],
      fileReferences: [{ path: '/legacy/papers/a', relativePath: 'papers/a', name: 'Paper A', kind: 'directory' }]
    })
    expect(mocked.chat.composerInput).toBe('Work draft')
    expect(mocked.chat.attachmentIds).toEqual(['work-image'])
    expect(mocked.chat.route).toBe('chat')
  })

  it('uploads only paper images to the paper source and newly created thread', async () => {
    await openPaperSpaceAssistant({ workspaceRoot: '/legacy', prompt: 'Explain the figure', images: [{ dataBase64: 'PNG', name: 'figure.png' }] })
    expect(mocked.upload).toHaveBeenCalledWith({ dataBase64: 'PNG', name: 'figure.png', mimeType: 'image/png', workspace: '/legacy', threadId: 'paper-thread' })
    expect(mocked.send.mock.calls[0][2]).toMatchObject({ attachmentIds: ['paper-image'], attachments: [{ id: 'paper-image', kind: 'image' }] })
  })

  it('rejects a late creation when the reader navigated to a different source', async () => {
    let finish!: (id: string) => void
    mocked.create.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve }))
    const opening = openPaperSpaceAssistant({ workspaceRoot: '/legacy', prompt: 'Explain' })
    const guard = mocked.create.mock.calls[0][0].activationGuard
    mocked.paper.readerKey = 'source-b/paper'
    mocked.chat.activeThreadId = 'paper-thread'
    expect(guard()).toBe(false)
    finish('paper-thread')
    await expect(opening).resolves.toBeNull()
    expect(mocked.send).not.toHaveBeenCalled()
    expect(mocked.chat.route).toBe('papers')
  })

  it.each(['reader', 'thread', 'route'])('does not send after %s changes during image upload', async (change) => {
    let finish!: (attachment: unknown) => void
    mocked.upload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const opening = openPaperSpaceAssistant({ workspaceRoot: '/legacy', prompt: 'Explain', images: [{ dataBase64: 'PNG', name: 'figure.png' }] })
    await vi.waitFor(() => expect(mocked.upload).toHaveBeenCalledTimes(1))
    if (change === 'reader') mocked.paper.readerKey = 'source-b/paper'
    if (change === 'thread') mocked.chat.activeThreadId = 'other-thread'
    if (change === 'route') mocked.chat.route = 'write'
    finish({ id: 'late-image' })
    await expect(opening).resolves.toBeNull()
    expect(mocked.send).not.toHaveBeenCalled()
    expect(mocked.chat.route).toBe(change === 'route' ? 'write' : 'papers')
  })

  it('does nothing without a source root or when thread creation fails', async () => {
    await expect(openPaperSpaceAssistant({ workspaceRoot: ' ', prompt: 'Explain' })).resolves.toBeNull()
    expect(mocked.create).not.toHaveBeenCalled()
    mocked.create.mockResolvedValueOnce(null)
    await expect(openPaperSpaceAssistant({ workspaceRoot: '/legacy', prompt: 'Explain' })).resolves.toBeNull()
    expect(mocked.send).not.toHaveBeenCalled()
  })
})
