import { describe, expect, it } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import type { ChatState } from './chat-store-types'
import {
  activeThreadIsUntouched,
  findReusableEmptyThreadId,
  isThreadAvailableForNewSession
} from './chat-store-runtime-helpers'
import {
  preparedWorktreeThreadForNewTask,
  reuseTargetStillEmpty,
  threadCreationIntentKey,
  threadMatchesCreationIntent
} from './thread-creation-intent'

const WORKSPACE = '/repo'
const thread = (id: string, extra: Partial<NormalizedThread> = {}): NormalizedThread => ({
  id,
  title: '',
  model: 'm',
  mode: 'agent',
  workspace: WORKSPACE,
  updatedAt: '2026-10-11T00:00:00.000Z',
  turnCount: 0,
  ...extra
} as NormalizedThread)
const userBlock = { kind: 'user', id: 'u1', text: 'hi' } as unknown as ChatBlock
const state = (overrides: Partial<ChatState>): ChatState => ({
  activeThreadId: null,
  threads: [],
  adeThreads: [],
  blocks: [],
  busy: false,
  busyUnconfirmed: false,
  queuedMessages: [],
  threadLoadingId: null,
  lastSeq: 0,
  ...overrides
} as unknown as ChatState)
const provider = (blocks: ChatBlock[] = []) => ({
  getThreadDetail: async () => ({ blocks })
})

describe('New-session emptiness rules', () => {
  it('excludes workflow-owned, archived and running rows from reuse', () => {
    expect(isThreadAvailableForNewSession(thread('t1'))).toBe(true)
    expect(isThreadAvailableForNewSession(thread('t1', { archived: true }))).toBe(false)
    expect(isThreadAvailableForNewSession(thread('t1', { relation: 'side' }))).toBe(false)
    expect(isThreadAvailableForNewSession(thread('t1', { taskOrigin: { intentId: 'i', taskId: 'k', index: 0, total: 1 } }))).toBe(false)
    expect(isThreadAvailableForNewSession(thread('t1', { executionUnit: { kind: 'worker', teamId: 't', managerThreadId: 'm', label: 'w', lifecycle: 'persistent', control: 'manager' } }))).toBe(false)
    expect(isThreadAvailableForNewSession(thread('t1', { status: 'queued' }))).toBe(false)
    expect(isThreadAvailableForNewSession(thread('t1', { latestTurnStatus: 'in_progress' }))).toBe(false)
  })

  it('treats an in-flight active thread as started', () => {
    expect(activeThreadIsUntouched(state({ activeThreadId: 't1' }))).toBe(true)
    expect(activeThreadIsUntouched(state({ activeThreadId: 't1', busy: true }))).toBe(false)
    expect(activeThreadIsUntouched(state({ activeThreadId: 't1', busyUnconfirmed: true }))).toBe(false)
    expect(activeThreadIsUntouched(state({ activeThreadId: 't1', queuedMessages: [{}] as never }))).toBe(false)
    expect(activeThreadIsUntouched(state({ activeThreadId: 't1', threadLoadingId: 't1' }))).toBe(false)
    expect(activeThreadIsUntouched(state({ activeThreadId: 't1', lastSeq: 4 }))).toBe(false)
    expect(activeThreadIsUntouched(state({ activeThreadId: 't1', blocks: [userBlock] }))).toBe(false)
  })

  it('never reuses a side conversation or a running row as the landing page', async () => {
    const id = await findReusableEmptyThreadId(
      state({ threads: [thread('side', { relation: 'side' }), thread('run', { status: 'running' })] }),
      provider(),
      WORKSPACE
    )
    expect(id).toBeNull()
  })

  it('does not treat a loading active thread as empty while its history is unknown', async () => {
    const id = await findReusableEmptyThreadId(
      state({ activeThreadId: 't1', threads: [thread('t1')], threadLoadingId: 't1' }),
      provider(),
      WORKSPACE
    )
    expect(id).toBeNull()
  })
})

describe('creation intent compatibility', () => {
  it('keeps persona threads apart from plain tasks', () => {
    expect(threadMatchesCreationIntent({ thread: thread('t1') })).toBe(true)
    expect(threadMatchesCreationIntent({ thread: thread('t1', { agentId: 'a' }) })).toBe(false)
    expect(threadMatchesCreationIntent({ thread: thread('t1', { agentId: 'a' }), agentId: 'a' })).toBe(true)
    expect(threadMatchesCreationIntent({ thread: thread('t1', { agentId: 'a' }), agentId: 'b' })).toBe(false)
  })

  it('keeps external-harness threads out of Kun task reuse', () => {
    expect(threadMatchesCreationIntent({ thread: thread('t1', { harnessId: 'kun' }) })).toBe(true)
    expect(threadMatchesCreationIntent({ thread: thread('t1', { harnessId: 'codex' }) })).toBe(false)
    expect(threadMatchesCreationIntent({ thread: thread('t1', { harnessId: 'codex' }), harnessId: 'codex' })).toBe(true)
  })

  it('separates intents that must create their own thread', () => {
    const base = { workspaceRoot: WORKSPACE }
    const key = (extra: Record<string, unknown>) =>
      threadCreationIntentKey({ ...base, ...extra } as never, state({}))
    expect(key({})).toBe(key({}))
    expect(key({})).not.toBe(key({ forceNew: true }))
    expect(key({})).not.toBe(key({ agentId: 'a' }))
    expect(key({})).not.toBe(key({ workspaceRoot: '/other' }))
    expect(key({})).not.toBe(key({ useWorktreePool: true }))
  })

  it('offers only the active thread already prepared for the same project as a worktree reuse target', () => {
    expect(preparedWorktreeThreadForNewTask(state({}), WORKSPACE)).toBeNull()
    expect(preparedWorktreeThreadForNewTask(
      state({ activeThreadId: 't1', threads: [thread('t1')] }), '/other'
    )).toBeNull()
    expect(preparedWorktreeThreadForNewTask(
      state({ activeThreadId: 't1', threads: [thread('t1')] }), WORKSPACE
    )).toBe('t1')
  })

  it('rejects a reuse target that started a turn while the lookup awaited', () => {
    const live = state({ activeThreadId: 't1', threads: [thread('t1')] })
    expect(reuseTargetStillEmpty(live, 't1')).toBe(true)
    expect(reuseTargetStillEmpty({ ...live, busy: true }, 't1')).toBe(false)
    expect(reuseTargetStillEmpty({ ...live, threads: [thread('t1', { turnCount: 1 })] }, 't1')).toBe(false)
    expect(reuseTargetStillEmpty({ ...live, threads: [thread('t1', { relation: 'fork' })] }, 't1')).toBe(false)
    expect(reuseTargetStillEmpty(live, 'missing')).toBe(false)
  })
})
