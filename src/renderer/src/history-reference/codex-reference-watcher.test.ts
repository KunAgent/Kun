import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { ChatBlock, NormalizedThread, ThreadDetail } from '../agent/types'
import type { ChatState } from '../store/chat-store-types'
import { applyCodexReferenceSettings, ensureCodexReferenceWatcher } from './codex-reference-watcher'
import { useCodexReferenceState } from './codex-reference-state'
import { useThreadTurnTarget, activateThreadTurnTarget } from '../components/chat/thread-turn-target'
import { buildPrefetchedThreadSnapshot, cacheThreadSnapshot, clearThreadSnapshotCache, getThreadSnapshot } from '../store/thread-snapshot-cache'
import { useChatStore } from '../store/chat-store'
import { loadEarlierThreadHistory } from '../store/chat-store-thread-history'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'

const mocks = vi.hoisted(() => ({ state: {} as ChatState, detail: vi.fn(), settings: vi.fn(), expanded: new Set<string>() }))
vi.mock('../agent/registry', () => ({ getProvider: () => ({ getThreadDetail: mocks.detail }) }))
vi.mock('../agent/runtime-client', () => ({ rendererRuntimeClient: { getSettings: mocks.settings } }))
vi.mock('../store/chat-store-thread-actions-support', () => ({ threadActionSharedState: { expandedHistoryThreadIds: mocks.expanded } }))
vi.mock('../store/chat-store', () => ({ useChatStore: {
  getState: () => mocks.state,
  setState: (patch: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => {
    mocks.state = { ...mocks.state, ...(typeof patch === 'function' ? patch(mocks.state) : patch) }
  }
} }))
const setting = (enabled: boolean): AppSettingsV1 => ({ agents: { kun: { lab: { codexReferenceBranches: { enabled } } } } }) as AppSettingsV1
const block = (id: string): ChatBlock => ({ kind: 'assistant', id, turnId: id, text: id })
const source = block('codex:old'), native = block('native-new')
const thread = (id: string): NormalizedThread => ({ id, title: id, historyRefId: `source-${id}`, updatedAt: '', model: '', mode: 'agent' })
const detail = (blocks: ChatBlock[], cursor?: string): ThreadDetail => ({ blocks, latestSeq: 10, historyCursor: cursor, hasMoreHistory: Boolean(cursor) })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.expanded.clear(); clearThreadSnapshotCache()
  useCodexReferenceState.setState({ enabled: null, revision: 0 })
  useThreadTurnTarget.setState({ target: null })
  mocks.state = { activeThreadId: 'a', threads: [thread('a'), thread('b')],
    blocks: [source, native], busy: true, currentTurnId: 'running', liveAssistant: 'streaming',
    liveReasoning: 'thinking', lastSeq: 71, liveDeltaSeqFloor: 70, runtimeConnection: 'ready',
    threadHistoryCursor: 'old', threadHasMoreHistory: true, threadLoadingId: null,
    threadRefreshingId: null, threadHistoryLoading: false } as ChatState
})
afterEach(() => { clearThreadSnapshotCache(); vi.unstubAllGlobals() })

describe('Codex laboratory history projection', () => {
  it('drops source snapshots and exact-turn overlays on disable while preserving native live state', async () => {
    useCodexReferenceState.setState({ enabled: true })
    const cached = buildPrefetchedThreadSnapshot(thread('b'), detail([source, native]))!
    cacheThreadSnapshot(cached)
    activateThreadTurnTarget('a', source.turnId!, detail([source]))
    const pending = deferred<ThreadDetail>(); mocks.detail.mockReturnValue(pending.promise)
    const task = applyCodexReferenceSettings(setting(false))
    expect(mocks.state.blocks).toEqual([native])
    expect(mocks.state.threadHistoryCursor).toBeNull()
    expect(getThreadSnapshot('b')).toBeNull()
    expect(useThreadTurnTarget.getState().target).toBeNull()
    expect(mocks.expanded.has('a')).toBe(true)
    expect(mocks.state).toMatchObject({ busy: true, currentTurnId: 'running', liveAssistant: 'streaming', liveReasoning: 'thinking', lastSeq: 71, liveDeltaSeqFloor: 70 })
    const duringRead = block('new-during-read'); mocks.state.blocks.push(duringRead)
    pending.resolve(detail([block('stale-native')], 'native-cursor')); await task
    expect(mocks.state.blocks).toEqual([native, duringRead])
    expect(mocks.state.threadHistoryCursor).toBe('native-cursor')
  })
  it('loads external history when enabling an open branch and invalidates snapshots cached while off', async () => {
    useCodexReferenceState.setState({ enabled: false })
    mocks.state.blocks = [native]
    cacheThreadSnapshot(buildPrefetchedThreadSnapshot(thread('b'), detail([]))!)
    mocks.detail.mockResolvedValue(detail([source, block('stale-native')], 'source-cursor'))
    await applyCodexReferenceSettings(setting(true))
    expect(mocks.state.blocks).toEqual([source, native])
    expect(getThreadSnapshot('b')).toBeNull()
    expect(mocks.state).toMatchObject({ threadHistoryCursor: 'source-cursor', threadHasMoreHistory: true, liveAssistant: 'streaming', lastSeq: 71 })
    await applyCodexReferenceSettings(setting(true))
    expect(mocks.detail).toHaveBeenCalledTimes(1)
  })
  it('discards an enable response after disabling or switching to a different thread', async () => {
    useCodexReferenceState.setState({ enabled: false })
    const older = deferred<ThreadDetail>(); mocks.detail.mockReturnValueOnce(older.promise).mockResolvedValue(detail([native]))
    const enable = applyCodexReferenceSettings(setting(true))
    await applyCodexReferenceSettings(setting(false))
    older.resolve(detail([source])); await enable
    expect(mocks.state.blocks).toEqual([native])
    expect(mocks.detail.mock.calls[0]?.[1].signal.aborted).toBe(true)
    const next = deferred<ThreadDetail>(); mocks.detail.mockReturnValueOnce(next.promise)
    const switched = applyCodexReferenceSettings(setting(true))
    mocks.state.activeThreadId = 'b'; mocks.state.blocks = [block('b-native')]
    next.resolve(detail([source])); await switched
    expect(mocks.state.blocks.map((item) => item.id)).toEqual(['b-native'])
  })
  it('ignores an in-flight exact-turn activation after disabling history', async () => {
    useCodexReferenceState.setState({ enabled: false })
    activateThreadTurnTarget('a', 'codex:old', detail([source]))
    expect(useThreadTurnTarget.getState().target).toBeNull()
    activateThreadTurnTarget('a', 'native-new', detail([native]))
    expect(useThreadTurnTarget.getState().target?.turnId).toBe('native-new')
  })
  it('rejects a late older-page result without restoring the source cursor or blocks', async () => {
    useCodexReferenceState.setState({ enabled: true })
    const earlier = deferred<ThreadDetail>()
    mocks.detail.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(detail([native], 'new-native-cursor'))
    const loading = loadEarlierThreadHistory(useChatStore.setState, useChatStore.getState)
    expect(mocks.state.threadHistoryLoading).toBe(true)
    await applyCodexReferenceSettings(setting(false))
    earlier.resolve(detail([source], 'old-source-cursor'))
    expect(await loading).toBe(false)
    expect(mocks.state).toMatchObject({ blocks: [native], threadHistoryCursor: 'new-native-cursor', threadHistoryLoading: false })
  })
  it('releases a cancelled native pagination spinner without removing its native cursor', async () => {
    useCodexReferenceState.setState({ enabled: true })
    mocks.state.threads = [{ ...thread('a'), historyRefId: undefined }]
    mocks.state.threadHistoryLoading = true
    mocks.state.blocks = [native]
    await applyCodexReferenceSettings(setting(false))
    expect(mocks.state).toMatchObject({ blocks: [native], threadHistoryCursor: 'old', threadHistoryLoading: false })
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('installs one settings listener and ignores an older startup settings response', async () => {
    const events = new EventTarget()
    const addEventListener = vi.spyOn(events, 'addEventListener')
    vi.stubGlobal('window', events)
    mocks.state.activeThreadId = null
    const startup = deferred<AppSettingsV1>(); mocks.settings.mockReturnValue(startup.promise)
    ensureCodexReferenceWatcher(); ensureCodexReferenceWatcher(); ensureCodexReferenceWatcher()
    expect(mocks.settings).toHaveBeenCalledTimes(1)
    expect(addEventListener).toHaveBeenCalledTimes(1)
    events.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: setting(true) }))
    startup.resolve(setting(false)); await startup.promise; await Promise.resolve()
    expect(useCodexReferenceState.getState().enabled).toBe(true)
  })
})
