import { describe, expect, it } from 'vitest'
import type { CoreRuntimeEventJson } from './kun-contract'
import { normalizeKunRuntimeEvent, type KunEventNormalizerDeps } from './kun-event-normalizer'
import type { RuntimeProjectionAction } from './runtime-projection-actions'
import type { ChatState } from '../store/chat-store-types'
import { reduceChatProjection } from '../store/chat-projection-reducer'

const NOW = Date.parse('2026-07-11T00:00:00.000Z')
const reducerContext = {
  now: NOW,
  clearRecoveringError: (error: string | null) => error,
  goalTimelineText: () => '',
  runtimeStatusText: () => '',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: event.message,
    message: event.message
  }),
  upsertRuntimeError: (blocks: ChatState['blocks']) => blocks,
  formatRuntimeError: (error: unknown) => String(error),
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false
}

function state(): ChatState {
  return {
    activeThreadId: 'thread_1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    threads: [],
    usageRefreshKey: 0
  } as unknown as ChatState
}

function project(initial: ChatState, actions: RuntimeProjectionAction[]): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, reducerContext) }),
    initial
  )
}

function handoffEvent(overrides: Partial<CoreRuntimeEventJson> = {}): CoreRuntimeEventJson {
  return {
    kind: 'handoff_injected',
    threadId: 'thread_1',
    turnId: 'turn_7',
    seq: 42,
    timestamp: '2026-07-11T00:00:00.000Z',
    reason: 'harness-switch',
    mode: 'full',
    harnessId: 'claude-code',
    from: { harnessName: 'Kun' },
    to: { harnessName: 'Claude Code', model: 'claude-sonnet-4-6' },
    workspace: { path: '/ws', branch: 'main' },
    stats: { recentTurns: 4, digestLines: 6, files: 2, commands: 1, bytes: 9_000 },
    briefDigest: 'a'.repeat(64),
    ...overrides
  } as CoreRuntimeEventJson
}

describe('handoff_injected normalization', () => {
  it('maps the wire event into a handoff_received projection action', () => {
    const actions = normalizeKunRuntimeEvent(
      handoffEvent(),
      {} as KunEventNormalizerDeps
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      type: 'handoff_received',
      seq: 42,
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_7',
        reason: 'harness-switch',
        mode: 'full',
        toHarnessName: 'Claude Code',
        toModel: 'claude-sonnet-4-6',
        recentTurns: 4,
        files: 2,
        briefDigest: 'a'.repeat(64),
        createdAt: '2026-07-11T00:00:00.000Z'
      }
    })
  })

  it('tolerates missing stats and defaults the reason to rebase', () => {
    const actions = normalizeKunRuntimeEvent(
      handoffEvent({
        reason: 'native_state_unavailable',
        stats: undefined,
        to: { harnessName: 'Cursor' }
      }),
      {} as KunEventNormalizerDeps
    )
    expect(actions[0]).toMatchObject({
      type: 'handoff_received',
      payload: {
        reason: 'rebase',
        toHarnessName: 'Cursor',
        recentTurns: 0,
        files: 0
      }
    })
  })

  it('drops events without a target harness or thread', () => {
    expect(
      normalizeKunRuntimeEvent(
        handoffEvent({ to: undefined }),
        {} as KunEventNormalizerDeps
      )
    ).toEqual([])
    expect(
      normalizeKunRuntimeEvent(
        handoffEvent({ threadId: undefined }),
        {} as KunEventNormalizerDeps
      )
    ).toEqual([])
  })
})

describe('handoff_received projection', () => {
  it('inserts a handoff marker block into the timeline', () => {
    const actions = normalizeKunRuntimeEvent(
      handoffEvent(),
      {} as KunEventNormalizerDeps
    )
    const projected = project(state(), actions)
    const block = projected.blocks.find((candidate) => candidate.kind === 'handoff')
    expect(block).toMatchObject({
      kind: 'handoff',
      turnId: 'turn_7',
      reason: 'harness-switch',
      handoffMode: 'full',
      toHarnessName: 'Claude Code',
      toModel: 'claude-sonnet-4-6',
      recentTurns: 4,
      files: 2,
      briefDigest: 'a'.repeat(64)
    })
  })

  it('deduplicates the same brief digest per turn', () => {
    const actions = [
      ...normalizeKunRuntimeEvent(handoffEvent(), {} as KunEventNormalizerDeps),
      ...normalizeKunRuntimeEvent(handoffEvent({ seq: 99 }), {} as KunEventNormalizerDeps)
    ]
    const projected = project(state(), actions)
    expect(
      projected.blocks.filter((candidate) => candidate.kind === 'handoff')
    ).toHaveLength(1)
  })

  it('keeps two distinct digests as separate markers', () => {
    const actions = [
      ...normalizeKunRuntimeEvent(handoffEvent(), {} as KunEventNormalizerDeps),
      ...normalizeKunRuntimeEvent(
        handoffEvent({ seq: 43, briefDigest: 'b'.repeat(64), mode: 'delta' }),
        {} as KunEventNormalizerDeps
      )
    ]
    const projected = project(state(), actions)
    const blocks = projected.blocks.filter((candidate) => candidate.kind === 'handoff')
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toMatchObject({ handoffMode: 'delta' })
  })
})
