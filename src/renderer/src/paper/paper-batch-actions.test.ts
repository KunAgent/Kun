import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaperBatchStore } from './paper-batch-store'
import { cancelPaperBatch, openPaperBatchAssistant, preparePaperBatch, startPaperBatch } from './paper-batch-actions'
import { deferred, entry, material } from '../components/paper/evidence/paper-evidence-test-support'

const state = vi.hoisted(() => ({
  chat: { route: 'write', activeThreadId: 'batch-thread', busy: false, runtimeConnection: 'ready', currentTurnId: null as string | null, error: null, createWriteThread: vi.fn(), recoverActiveTurn: vi.fn(), selectWriteThread: vi.fn() },
  workspace: { workspaceRoot: '/library', activeFilePath: null as string | null, workSurface: 'papers', paperReading: { papersDir: 'papers' }, entriesByDir: {}, paperResearch: { sessionId: null }, setAssistantOpen: vi.fn() },
  provider: { sendUserMessage: vi.fn(), getThreadState: vi.fn(), getThreadDetail: vi.fn(), interruptTurn: vi.fn() },
  api: { paperLibraryList: vi.fn(), paperEvidenceMaterial: vi.fn(), createWorkspaceFile: vi.fn(), paperReadUnit: vi.fn(), paperRecordInterpretation: vi.fn() },
  navigation: { surface: 'workspace' }, activationAllowed: true, switchLibrary: vi.fn(), openAssistant: vi.fn(), refresh: vi.fn()
}))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: () => state.chat } }))
vi.mock('../write/write-workspace-store', () => ({ useWriteWorkspaceStore: { getState: () => state.workspace } }))
vi.mock('../write/work-assistant-navigation', () => ({ useWorkAssistantNavigation: { getState: () => Object.assign(state.navigation, { openAssistant: state.openAssistant }) } }))
vi.mock('../write/paper/paper-store', () => ({ usePaperStore: { getState: () => ({ unitsByDir: {}, setNotice: vi.fn() }) } }))
vi.mock('../agent/registry', () => ({ getProvider: () => state.provider }))
vi.mock('./paper-mode-actions', () => ({ switchPaperLibrary: state.switchLibrary }))
vi.mock('./paper-library-index', () => ({ refreshPaperLibrary: state.refresh }))
vi.mock('./paper-batch-navigation', () => ({ focusPaperBatchLibrary: () => () => state.activationAllowed, selectPaperBatchConversation: vi.fn(async () => undefined) }))
vi.mock('./paper-view', () => ({ paperModeView: () => 'library' }))

const input = { providerId: 'provider', model: 'fixed-model', language: 'en' }
const second = { ...entry, unitDir: 'papers/b', meta: { ...entry.meta, slug: 'b', title: 'Paper B' } }
const batch = () => usePaperBatchStore.getState().batch!
async function stage(entries = [entry, second]): Promise<void> {
  usePaperBatchStore.getState().stage('/library', entries, 'Research group')
  await preparePaperBatch(batch().id)
}
function consent(): void { usePaperBatchStore.getState().update(batch().id, { consent: true }) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { kunGui: state.api })
  state.workspace.workspaceRoot = '/library'
  state.workspace.activeFilePath = null
  state.navigation = { surface: 'workspace' }
  state.activationAllowed = true
  state.chat.activeThreadId = 'batch-thread'
  state.chat.route = 'write'
  state.chat.busy = false
  state.chat.runtimeConnection = 'ready'
  usePaperBatchStore.setState({ batch: null })
  state.api.paperEvidenceMaterial.mockResolvedValue(material)
  state.api.paperReadUnit.mockImplementation(async ({ unitDir }) => ({ ok: true, meta: unitDir === entry.unitDir ? entry.meta : second.meta }))
  state.api.createWorkspaceFile.mockResolvedValue({ ok: true, path: 'created' })
  state.api.paperRecordInterpretation.mockResolvedValue({ ok: true, meta: entry.meta })
  state.chat.createWriteThread.mockResolvedValue('batch-thread')
  state.chat.recoverActiveTurn.mockResolvedValue(true)
  state.provider.sendUserMessage.mockImplementation(async () => ({ threadId: 'batch-thread', turnId: `turn-${state.provider.sendUserMessage.mock.calls.length}` }))
  state.provider.getThreadState.mockImplementation(async () => ({ latestTurnId: `turn-${state.provider.sendUserMessage.mock.calls.length}`, latestTurnStatus: 'completed' }))
  state.provider.getThreadDetail.mockImplementation(async (_thread, { turnId }) => ({ blocks: [
    { kind: 'assistant', turnId: 'other', text: 'Must never save unrelated output' },
    { kind: 'assistant', turnId, text: `Explanation ${turnId}` }
  ] }))
  state.provider.interruptTurn.mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('bounded paper batch controller', () => {
  it('stages a deduplicated removable snapshot without a model, thread or file write', async () => {
    await openPaperBatchAssistant({ workspaceRoot: '/library', entries: [entry, entry, second], sourceLabel: 'Group' })
    await preparePaperBatch(batch().id)
    expect(batch().items).toHaveLength(2)
    expect(batch().consent).toBe(false)
    expect(state.openAssistant).toHaveBeenCalledOnce()
    expect(state.provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.chat.createWriteThread).not.toHaveBeenCalled()
    expect(state.api.createWorkspaceFile).not.toHaveBeenCalled()
    usePaperBatchStore.getState().remove(entry.unitDir)
    expect(batch().items[0].entry.meta.title).toBe(second.meta.title)
  })
  it('keeps the newest staging intent when an uncached library scan finishes late', async () => {
    const scan = deferred<{ ok: true; entries: typeof entry[] }>()
    state.api.paperLibraryList.mockReturnValue(scan.promise)
    const old = openPaperBatchAssistant({ workspaceRoot: '/slow-library', sourceLabel: 'Slow library' })
    await openPaperBatchAssistant({ workspaceRoot: '/library', entries: [second], sourceLabel: 'New selection' })
    scan.resolve({ ok: true, entries: [entry] })
    await expect(old).resolves.toBe(false)
    expect(batch().sourceLabel).toBe('New selection')
    expect(state.switchLibrary).not.toHaveBeenCalled()
  })
  it.each(['paper', 'route', 'root', 'presentation', 'conversation'])('does not stage a slow library scan after newer %s navigation', async (target) => {
    const scan = deferred<{ ok: true; entries: typeof entry[] }>()
    state.api.paperLibraryList.mockReturnValue(scan.promise)
    const pending = openPaperBatchAssistant({ workspaceRoot: '/library', sourceLabel: 'Late' })
    if (target === 'paper') state.workspace.activeFilePath = '/library/papers/b/paper.pdf'
    if (target === 'route') state.chat.route = 'chat'
    if (target === 'root') state.workspace.workspaceRoot = '/other-library'
    if (target === 'presentation') state.navigation = { surface: 'assistant' }
    if (target === 'conversation') state.chat.activeThreadId = 'newer-conversation'
    scan.resolve({ ok: true, entries: [entry] })
    await expect(pending).resolves.toBe(false)
    expect(usePaperBatchStore.getState().batch).toBeNull()
    expect(state.openAssistant).not.toHaveBeenCalled()
  })
  it('closing a staged batch invalidates an older pending library scan', async () => {
    await stage([entry])
    const scan = deferred<{ ok: true; entries: typeof entry[] }>()
    state.api.paperLibraryList.mockReturnValue(scan.promise)
    const pending = openPaperBatchAssistant({ workspaceRoot: '/library', sourceLabel: 'Late' })
    usePaperBatchStore.getState().close()
    scan.resolve({ ok: true, entries: [second] })
    await expect(pending).resolves.toBe(false)
    expect(usePaperBatchStore.getState().batch).toBeNull()
  })
  it('retains a created batch thread but sends no model request after newer document navigation', async () => {
    await stage([entry])
    consent()
    state.chat.createWriteThread.mockImplementation(async () => { state.activationAllowed = false; return 'batch-thread' })
    await startPaperBatch(input)
    expect(batch().threadId).toBe('batch-thread')
    expect(batch().resourcePath).toBe('')
    expect(batch().phase).toBe('paused')
    expect(state.provider.sendUserMessage).not.toHaveBeenCalled()
  })
  it('requires consent, a fixed model, a valid count and complete deeper-reading material', async () => {
    await stage()
    await startPaperBatch(input)
    expect(state.chat.createWriteThread).not.toHaveBeenCalled()
    consent()
    await startPaperBatch({ ...input, model: 'auto' })
    expect(state.chat.createWriteThread).not.toHaveBeenCalled()
    usePaperBatchStore.getState().updateItem(batch().id, entry.unitDir, { material: { ...material, abstractOnly: true } })
    usePaperBatchStore.getState().update(batch().id, { purpose: 'method-deep-read' })
    await startPaperBatch(input)
    expect(state.provider.sendUserMessage).not.toHaveBeenCalled()
    usePaperBatchStore.getState().update(batch().id, { purpose: 'quick-screen' })
    await startPaperBatch(input)
    expect(state.provider.sendUserMessage.mock.calls[0][1]).toContain('limited-material screening')
    expect(batch().items.every((item) => item.status === 'completed')).toBe(true)
  })
  it('allows staging but refuses Start while another request runs or the runtime is disconnected', async () => {
    await stage([entry])
    consent()
    state.chat.busy = true
    await startPaperBatch(input)
    expect(state.chat.createWriteThread).not.toHaveBeenCalled()
    state.chat.busy = false
    state.chat.runtimeConnection = 'disconnected'
    await startPaperBatch(input)
    expect(state.provider.sendUserMessage).not.toHaveBeenCalled()
  })
  it('cannot replace or close an active batch and freeze its selected source before sending', async () => {
    await stage([entry])
    consent()
    const pending = deferred<string>()
    state.chat.createWriteThread.mockReturnValue(pending.promise)
    const running = startPaperBatch(input)
    expect(usePaperBatchStore.getState().stage('/library', [second], 'Replacement')).toBe(false)
    usePaperBatchStore.getState().close()
    expect(batch().sourceLabel).toBe('Research group')
    pending.resolve('batch-thread')
    await running
    expect(state.provider.sendUserMessage).toHaveBeenCalledOnce()
  })
  it('does not silently drop an oversized batch or read all its materials', async () => {
    await stage(Array.from({ length: 22 }, (_, index) => ({ ...entry, unitDir: `papers/${index}` })))
    expect(batch().items).toHaveLength(22)
    expect(state.api.paperEvidenceMaterial).not.toHaveBeenCalled()
    consent()
    await startPaperBatch(input)
    expect(state.provider.sendUserMessage).not.toHaveBeenCalled()
  })
  it('a failed source read cannot fall back to stale indexed abstracts', async () => {
    state.api.paperEvidenceMaterial.mockResolvedValue({ ok: false, message: 'Source unavailable' })
    await stage([entry])
    consent()
    await startPaperBatch(input)
    expect(batch().items[0].materialState).toBe('error')
    expect(state.provider.sendUserMessage).not.toHaveBeenCalled()
  })
  it('ignores stale preparations after a new staging request', async () => {
    const pending = deferred<typeof material>()
    state.api.paperEvidenceMaterial.mockReturnValue(pending.promise)
    usePaperBatchStore.getState().stage('/library', [entry], 'Old')
    const preparing = preparePaperBatch(batch().id)
    usePaperBatchStore.getState().stage('/library', [second], 'New')
    pending.resolve(material)
    await preparing
    expect(batch().sourceLabel).toBe('New')
    expect(batch().items[0].materialState).toBe('waiting')
  })
  it('repeated Start calls create one thread and send sequential scoped requests', async () => {
    await stage()
    consent()
    await Promise.all([startPaperBatch(input), startPaperBatch(input)])
    expect(state.chat.createWriteThread).toHaveBeenCalledTimes(1)
    expect(state.provider.sendUserMessage).toHaveBeenCalledTimes(2)
    const options = state.provider.sendUserMessage.mock.calls[0][2]
    expect(options).toMatchObject({ agentSurface: 'write', providerId: input.providerId, model: input.model,
      paperContext: { scope: 'current-paper', privacy: 'model-provider', maxModelRequests: 1, model: input.model } })
    expect(options.paperContext.sources).toHaveLength(1)
    expect(options.paperContext.sources[0].text).toBe(material.sourceText)
    expect(batch().phase).toBe('settled')
    expect(state.api.createWorkspaceFile).not.toHaveBeenCalled()
  })
  it('cancels during admission using the exact receipt and leaves later papers unsent', async () => {
    await stage()
    consent()
    const receipt = deferred<{ threadId: string; turnId: string }>()
    state.provider.sendUserMessage.mockReturnValue(receipt.promise)
    state.provider.getThreadState.mockResolvedValueOnce({ latestTurnId: 'owned-turn', latestTurnStatus: 'running' }).mockResolvedValue({ latestTurnId: 'owned-turn', latestTurnStatus: 'aborted' })
    const running = startPaperBatch(input)
    await vi.waitFor(() => expect(state.provider.sendUserMessage).toHaveBeenCalledOnce())
    cancelPaperBatch()
    receipt.resolve({ threadId: 'batch-thread', turnId: 'owned-turn' })
    await running
    expect(state.provider.interruptTurn).toHaveBeenCalledWith('batch-thread', 'owned-turn')
    expect(state.provider.sendUserMessage).toHaveBeenCalledOnce()
    expect(batch().items.map((item) => item.status)).toEqual(['canceled', 'canceled'])
  })
  it('keeps a result when completion wins the Cancel race and never starts the next paper', async () => {
    await stage()
    consent()
    const receipt = deferred<{ threadId: string; turnId: string }>()
    state.provider.sendUserMessage.mockReturnValue(receipt.promise)
    state.provider.getThreadState.mockResolvedValue({ latestTurnId: 'done-turn', latestTurnStatus: 'completed' })
    const running = startPaperBatch(input)
    await vi.waitFor(() => expect(state.provider.sendUserMessage).toHaveBeenCalledOnce())
    cancelPaperBatch()
    receipt.resolve({ threadId: 'batch-thread', turnId: 'done-turn' })
    await running
    expect(state.provider.interruptTurn).not.toHaveBeenCalled()
    expect(state.provider.sendUserMessage).toHaveBeenCalledOnce()
    expect(batch().items.map((item) => item.status)).toEqual(['completed', 'canceled'])
    expect(batch().items[0].result).toBe('Explanation done-turn')
  })
  it('does not send after a library switch during conversation creation', async () => {
    await stage()
    consent()
    state.chat.createWriteThread.mockImplementation(async () => { state.workspace.workspaceRoot = '/other'; return 'batch-thread' })
    await startPaperBatch(input)
    expect(state.provider.sendUserMessage).not.toHaveBeenCalled()
    expect(batch().phase).toBe('paused')
  })
  it('retains idempotency and frozen provider/model across an uncertain admission retry', async () => {
    await stage([entry])
    consent()
    state.provider.sendUserMessage.mockRejectedValueOnce(new Error('Connection lost'))
    await startPaperBatch(input)
    expect(batch().items[0].status).toBe('uncertain')
    const first = state.provider.sendUserMessage.mock.calls[0][2]
    consent()
    await startPaperBatch({ providerId: 'other-provider', model: 'other-model', language: 'zh' })
    const next = state.provider.sendUserMessage.mock.calls[1][2]
    expect(next.clientRequestId).toBe(first.clientRequestId)
    expect(next.paperContext).toEqual(first.paperContext)
    expect(next.providerId).toBe('provider')
    expect(batch().items[0].status).toBe('completed')
  })
  it('fails closed rather than treating an unrelated newer turn as the batch result', async () => {
    await stage([entry])
    consent()
    state.provider.getThreadState.mockResolvedValue({ latestTurnId: 'unrelated', latestTurnStatus: 'completed' })
    await startPaperBatch(input)
    expect(batch().phase).toBe('paused')
    expect(batch().items[0].status).toBe('uncertain')
    expect(state.api.createWorkspaceFile).not.toHaveBeenCalled()
  })
  it('only saves exact-turn assistant text to approved new article files, then registers them', async () => {
    await stage([entry])
    usePaperBatchStore.getState().update(batch().id, { destination: 'paper-files' })
    consent()
    await startPaperBatch(input)
    expect(state.api.createWorkspaceFile).toHaveBeenCalledWith({ workspaceRoot: '/library', path: expect.stringMatching(/^papers\/a\/Paper A-explanation-.+\.md$/), content: 'Explanation turn-1' })
    expect(state.api.paperRecordInterpretation).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: '/library', unitDir: entry.unitDir, threadId: 'batch-thread' }))
    expect(batch().items[0].outputRecorded).toBe(true)
  })
  it('retries a failed save without another model request or overwriting a created file', async () => {
    await stage([entry])
    usePaperBatchStore.getState().update(batch().id, { destination: 'paper-files' })
    consent()
    state.api.paperRecordInterpretation.mockResolvedValueOnce({ ok: false, message: 'Could not register' })
    await startPaperBatch(input)
    expect(batch().items[0].error).toBe('Could not register')
    consent()
    await startPaperBatch(input)
    expect(state.provider.sendUserMessage).toHaveBeenCalledOnce()
    expect(state.api.createWorkspaceFile).toHaveBeenCalledOnce()
    expect(state.api.paperRecordInterpretation).toHaveBeenCalledTimes(2)
    expect(batch().items[0].outputRecorded).toBe(true)
  })
  it('does not resurrect a removed or changed paper directory to save an article', async () => {
    await stage([entry])
    usePaperBatchStore.getState().update(batch().id, { destination: 'paper-files' })
    consent()
    state.api.paperReadUnit.mockResolvedValue({ ok: false, message: 'Paper was removed' })
    await startPaperBatch(input)
    expect(state.api.createWorkspaceFile).not.toHaveBeenCalled()
    expect(batch().items[0].status).toBe('completed')
    expect(batch().items[0].result).toBe('Explanation turn-1')
    expect(batch().items[0].error).toBe('Paper was removed')
  })
})
