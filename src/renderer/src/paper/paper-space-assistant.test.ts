/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPaperSpaceAssistant, selectPaperSpaceAssistant } from './paper-space-assistant'
import { paperAssistantSession, patchPaperAssistant, usePaperAssistantStore } from './paper-space-assistant-state'

const mocked = vi.hoisted(() => ({
  create: vi.fn(), select: vi.fn(), send: vi.fn(), upload: vi.fn(), summary: vi.fn(),
  chat: { route: 'papers', activeThreadId: 'work-thread', composerInput: 'Work draft',
    attachmentIds: ['work-image'], threads: [] as { id: string }[], error: null as string | null,
    composerModel: 'model', composerProviderId: 'provider', runtimeConnection: 'ready',
    composerReasoningEffort: 'high', composerFastMode: false, composerModelGroups: [] },
  paper: { readerKey: '/legacy\0papers/a' }
}))
vi.mock('../store/chat-store', () => ({ useChatStore: {
  getState: () => ({ ...mocked.chat, selectThread: mocked.select, sendMessage: mocked.send }),
  setState: (patch: Partial<typeof mocked.chat> | ((state: typeof mocked.chat) => Partial<typeof mocked.chat>)) =>
    Object.assign(mocked.chat, typeof patch === 'function' ? patch(mocked.chat) : patch)
} }))
vi.mock('../agent/registry', () => ({ getProvider: () => ({ createThread: mocked.create, uploadAttachment: mocked.upload,
  getThreadSummary: mocked.summary }) }))
vi.mock('./paper-space-store', () => ({
  paperSpaceItemKey: (root: string, unit: string) => `${root}\0${unit}`,
  usePaperSpaceStore: { getState: () => mocked.paper }
}))

const key = '/legacy\0papers/a'
const source = { workspaceRoot: '/legacy', unitDir: 'papers/a', title: 'Paper A' }
const image = { dataBase64: 'PNG', name: 'figure.png' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.summary.mockImplementation(async (id: string) => ({ id, workspace: id === 'second-thread' ? '/second' : '/legacy', agentSurface: 'write' }))
  usePaperAssistantStore.setState({ sessions: {} })
  Object.assign(mocked.chat, { route: 'papers', activeThreadId: 'work-thread', composerInput: 'Work draft',
    attachmentIds: ['work-image'], threads: [], error: null, composerModel: 'model', composerProviderId: 'provider',
    composerReasoningEffort: 'high', composerFastMode: false, composerModelGroups: [] })
  mocked.paper.readerKey = key
  mocked.create.mockResolvedValue({ id: 'paper-thread', workspace: '/legacy', agentSurface: 'write' })
  mocked.select.mockImplementation(async (id: string, options: { selectionGuard: () => boolean }) => {
    if (options.selectionGuard()) mocked.chat.activeThreadId = id
  })
  mocked.send.mockResolvedValue(true)
  mocked.upload.mockResolvedValue({ id: 'paper-image', name: 'figure.png', mimeType: 'image/png' })
})

describe('paper assistant source and thread isolation', () => {
  it('reuses one Work-surface thread per PDF without navigating or consuming Work composer state', async () => {
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'Explain this paper' })).resolves.toBe('paper-thread')
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'What are the limitations?' })).resolves.toBe('paper-thread')
    expect(mocked.create).toHaveBeenCalledExactlyOnceWith({
      workspace: '/legacy', title: 'Paper A', mode: 'agent', agentSurface: 'write'
    })
    expect(mocked.send).toHaveBeenCalledWith('Explain this paper', 'agent', {
      expectedThreadId: 'paper-thread', submissionGuard: expect.any(Function), agentSurface: 'write', attachmentIds: [], attachments: [], composerContexts: [],
      fileReferences: [{ path: '/legacy/papers/a', relativePath: 'papers/a', name: 'Paper A', kind: 'directory' }],
      model: '', providerId: '', reasoningEffort: 'high', serviceTier: undefined
    })
    expect(mocked.chat.composerInput).toBe('Work draft')
    expect(mocked.chat.attachmentIds).toEqual(['work-image'])
    expect(mocked.chat.route).toBe('papers')
  })

  it('separates identical unitDirs in different libraries and restores the original thread', async () => {
    await openPaperSpaceAssistant({ ...source, prompt: 'First' })
    mocked.paper.readerKey = '/second\0papers/a'
    mocked.create.mockResolvedValueOnce({ id: 'second-thread', workspace: '/second', agentSurface: 'write' })
    await openPaperSpaceAssistant({ ...source, workspaceRoot: '/second', prompt: 'Second' })
    expect(paperAssistantSession(key).threadId).toBe('paper-thread')
    expect(paperAssistantSession('/second\0papers/a').threadId).toBe('second-thread')
    mocked.paper.readerKey = key
    await selectPaperSpaceAssistant(key)
    expect(mocked.chat.activeThreadId).toBe('paper-thread')
    await openPaperSpaceAssistant({ ...source, prompt: 'Follow up' })
    expect(mocked.create).toHaveBeenCalledTimes(2)
    expect(mocked.send.mock.lastCall?.[2].expectedThreadId).toBe('paper-thread')
  })

  it('uploads only this PDF draft images into its source and thread', async () => {
    patchPaperAssistant(key, { input: 'Explain the figure', images: [image] })
    await openPaperSpaceAssistant({ ...source, prompt: 'Explain the figure', images: [image], consumeDraft: true })
    expect(mocked.upload).toHaveBeenCalledWith({ ...image, mimeType: 'image/png', workspace: '/legacy', threadId: 'paper-thread' })
    expect(mocked.send.mock.calls[0][2]).toMatchObject({ attachmentIds: ['paper-image'], attachments: [{ id: 'paper-image', kind: 'image' }] })
    expect(paperAssistantSession(key)).toMatchObject({ input: '', images: [], sending: false, error: null })
  })

  it('reading-purpose actions preserve unsent text, screenshots and the existing conversation', async () => {
    patchPaperAssistant(key, { input: 'My unfinished question', images: [image] })
    await openPaperSpaceAssistant({ ...source, prompt: 'Read for reproduction' })
    await openPaperSpaceAssistant({ ...source, prompt: 'Critique this paper' })
    expect(paperAssistantSession(key)).toMatchObject({ input: 'My unfinished question', images: [image], layout: 'assistant' })
    expect(mocked.create).toHaveBeenCalledTimes(1)
    expect(mocked.upload).not.toHaveBeenCalled()
  })

  it('does not select or send a late creation after navigating away', async () => {
    const pending = deferred<{ id: string }>()
    mocked.create.mockReturnValueOnce(pending.promise)
    const opening = openPaperSpaceAssistant({ ...source, prompt: 'Explain' })
    mocked.paper.readerKey = '/second\0papers/a'
    pending.resolve({ id: 'late-thread' })
    await expect(opening).resolves.toBeNull()
    expect(mocked.select).not.toHaveBeenCalled()
    expect(mocked.send).not.toHaveBeenCalled()
    expect(mocked.chat.activeThreadId).toBe('work-thread')
    expect(paperAssistantSession(key).threadId).toBe('late-thread')
    expect(paperAssistantSession(key).sending).toBe(false)
  })

  it.each(['reader', 'thread', 'route'])('does not send after %s changes during upload', async (change) => {
    const pending = deferred<{ id: string }>()
    mocked.upload.mockReturnValueOnce(pending.promise)
    patchPaperAssistant(key, { input: 'Explain', images: [image] })
    const opening = openPaperSpaceAssistant({ ...source, prompt: 'Explain', images: [image], consumeDraft: true })
    await vi.waitFor(() => expect(mocked.upload).toHaveBeenCalledTimes(1))
    if (change === 'reader') mocked.paper.readerKey = '/second\0papers/a'
    if (change === 'thread') mocked.chat.activeThreadId = 'other-thread'
    if (change === 'route') mocked.chat.route = 'write'
    pending.resolve({ id: 'late-image' })
    await expect(opening).resolves.toBeNull()
    expect(mocked.send).not.toHaveBeenCalled()
    expect(paperAssistantSession(key)).toMatchObject({ input: 'Explain', images: [image], sending: false })
    expect(mocked.chat.route).toBe(change === 'route' ? 'write' : 'papers')
  })

  it('retains draft and screenshots on failed send and can retry without making another thread', async () => {
    patchPaperAssistant(key, { input: 'Explain', images: [image] })
    mocked.send.mockResolvedValueOnce(false)
    mocked.chat.error = 'Connection unavailable'
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'Explain', images: [image], consumeDraft: true })).resolves.toBeNull()
    expect(paperAssistantSession(key)).toMatchObject({ input: 'Explain', images: [image], error: 'Connection unavailable', sending: false })
    await openPaperSpaceAssistant({ ...source, prompt: 'Explain', images: [image], consumeDraft: true })
    expect(mocked.create).toHaveBeenCalledTimes(1)
    expect(paperAssistantSession(key)).toMatchObject({ input: '', images: [], error: null })
  })

  it('never clears edits or new screenshots added while a draft send is pending', async () => {
    const pending = deferred<{ id: string }>()
    mocked.upload.mockReturnValueOnce(pending.promise)
    patchPaperAssistant(key, { input: 'Old draft', images: [image] })
    const opening = openPaperSpaceAssistant({ ...source, prompt: 'Old draft', images: [image], consumeDraft: true })
    await vi.waitFor(() => expect(mocked.upload).toHaveBeenCalled())
    const newer = { dataBase64: 'NEW', name: 'new.png' }
    patchPaperAssistant(key, { input: 'New draft', images: [image, newer] })
    pending.resolve({ id: 'image' })
    await opening
    expect(paperAssistantSession(key)).toMatchObject({ input: 'New draft', images: [newer] })
  })

  it('releases creation lock after an error and fences concurrent requests', async () => {
    const pending = deferred<{ id: string }>()
    mocked.create.mockReturnValueOnce(pending.promise)
    const first = openPaperSpaceAssistant({ ...source, prompt: 'First' })
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'Duplicate' })).resolves.toBeNull()
    expect(mocked.create).toHaveBeenCalledTimes(1)
    pending.resolve({ id: 'paper-thread' })
    await first
    usePaperAssistantStore.setState({ sessions: {} })
    localStorage.clear()
    mocked.create.mockRejectedValueOnce(new Error('Thread unavailable'))
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'Try' })).resolves.toBeNull()
    expect(paperAssistantSession(key)).toMatchObject({ error: 'Thread unavailable', sending: false })
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'Retry' })).resolves.toBe('paper-thread')
  })

  it('does not create a thread for an empty prompt or invalid source', async () => {
    await openPaperSpaceAssistant(source)
    await openPaperSpaceAssistant({ ...source, workspaceRoot: ' ', prompt: 'Explain' })
    await openPaperSpaceAssistant({ ...source, unitDir: 'different', prompt: 'Explain' })
    expect(mocked.create).not.toHaveBeenCalled()
    expect(mocked.send).not.toHaveBeenCalled()
  })
})


it('uses the paper-selected Kun model rather than inheriting a Code native model', async () => {
  mocked.chat.composerModel = 'native-model-not-in-kun'
  mocked.chat.composerProviderId = 'native-login'
  patchPaperAssistant(key, { input: 'Explain', model: 'paper-model', providerId: 'kun-provider' })
  await openPaperSpaceAssistant({ ...source, prompt: 'Explain', consumeDraft: true })
  expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'paper-model', providerId: 'kun-provider', agentSurface: 'write' }))
  expect(mocked.send).toHaveBeenCalledWith('Explain', 'agent', expect.objectContaining({ model: 'paper-model', providerId: 'kun-provider' }))
  const guard = mocked.send.mock.calls[0][2].submissionGuard as () => boolean
  expect(guard()).toBe(true)
  mocked.paper.readerKey = '/other\0papers/b'
  expect(guard()).toBe(false)
})

it('restores the persisted PDF thread after renderer sessions and thread list are rebuilt', async () => {
  await openPaperSpaceAssistant({ ...source, prompt: 'First' })
  usePaperAssistantStore.setState({ sessions: {} })
  mocked.chat.threads = []
  mocked.chat.activeThreadId = 'work-thread'
  mocked.create.mockClear()
  await expect(openPaperSpaceAssistant({ ...source, prompt: 'Continue' })).resolves.toBe('paper-thread')
  expect(mocked.summary).toHaveBeenLastCalledWith('paper-thread')
  expect(mocked.create).not.toHaveBeenCalled()
  expect(mocked.send.mock.lastCall?.[2].expectedThreadId).toBe('paper-thread')
  expect(usePaperAssistantStore.getState().sessions[key].threadId).toBe('paper-thread')
})

it.each(['archived', 'deleted'])('refuses a persisted %s thread even if it is active', async (status) => {
  patchPaperAssistant(key, { threadId: 'paper-thread', input: 'Keep draft', images: [image] })
  usePaperAssistantStore.setState({ sessions: {} })
  mocked.chat.activeThreadId = 'paper-thread'
  mocked.summary.mockResolvedValue({ id: 'paper-thread', workspace: '/legacy', agentSurface: 'write', status })
  await expect(openPaperSpaceAssistant({ ...source, prompt: 'Continue' })).resolves.toBeNull()
  expect(paperAssistantSession(key).error).toContain('deleted or archived')
  expect(mocked.create).not.toHaveBeenCalled()
  expect(mocked.select).not.toHaveBeenCalled()
  expect(mocked.send).not.toHaveBeenCalled()
})

it.each(['Thread not found (404)', 'Runtime validation timed out'])(
  'does not replace a persisted thread when validation fails: %s', async (message) => {
    patchPaperAssistant(key, { threadId: 'paper-thread', input: 'Keep draft', images: [image] })
    mocked.summary.mockRejectedValueOnce(new Error(message))
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'Continue', consumeDraft: true })).resolves.toBeNull()
    expect(paperAssistantSession(key)).toMatchObject({ threadId: 'paper-thread', input: 'Keep draft', images: [image], error: message })
    expect(mocked.create).not.toHaveBeenCalled()
    expect(mocked.send).not.toHaveBeenCalled()
  }
)

it.each([{ workspace: '/other', agentSurface: 'write' }, { workspace: '/legacy', agentSurface: 'code' }])(
  'rejects a binding with mismatched runtime ownership: %j', async (metadata) => {
    patchPaperAssistant(key, { threadId: 'paper-thread' })
    mocked.summary.mockResolvedValueOnce({ id: 'paper-thread', ...metadata })
    await expect(openPaperSpaceAssistant({ ...source, prompt: 'Continue' })).resolves.toBeNull()
    expect(paperAssistantSession(key).error).toContain('does not belong')
    expect(mocked.send).not.toHaveBeenCalled()
    expect(mocked.create).not.toHaveBeenCalled()
  }
)

it('restores different papers in the same library without cross-binding their threads', async () => {
  await openPaperSpaceAssistant({ ...source, prompt: 'A' })
  mocked.paper.readerKey = '/legacy\0papers/b'
  mocked.create.mockResolvedValueOnce({ id: 'b-thread', workspace: '/legacy', agentSurface: 'write' })
  await openPaperSpaceAssistant({ ...source, unitDir: 'papers/b', prompt: 'B' })
  usePaperAssistantStore.setState({ sessions: {} })
  mocked.paper.readerKey = key
  await openPaperSpaceAssistant({ ...source, prompt: 'A again' })
  expect(mocked.send.mock.lastCall?.[2].expectedThreadId).toBe('paper-thread')
  mocked.paper.readerKey = '/legacy\0papers/b'
  await openPaperSpaceAssistant({ ...source, unitDir: 'papers/b', prompt: 'B again' })
  expect(mocked.send.mock.lastCall?.[2].expectedThreadId).toBe('b-thread')
  expect(mocked.create).toHaveBeenCalledTimes(2)
})
