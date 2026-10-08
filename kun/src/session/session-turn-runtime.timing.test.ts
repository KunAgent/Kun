import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionTurnRuntime, type SessionTurnRuntimeDeps } from './session-turn-runtime.js'
import { HarnessAgentPool } from './harness-pool.js'
import type { HarnessAgent, HarnessSession, HarnessSessionStartInput, HarnessTurnSink } from './harness-session.js'
import { resolveSessionTurnContext, type SessionTurnContext } from './session-turn-context.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import { setHarnessTimingClock } from '../runtime/harness-turn-timing.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore } from '../runtime/delegated-session-binding.js'

vi.mock('./session-turn-context.js', () => ({ resolveSessionTurnContext: vi.fn() }))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  setHarnessTimingClock(undefined)
  for (const fn of cleanup.splice(0)) await fn()
})

const text = 'abcdefghij'.repeat(3) + 'abcde' // 10 estimated tokens
let offset = 0
const delta = (): RuntimeEventDraft => {
  const draft = {
    kind: 'assistant_text_delta', threadId: 'thread', turnId: 'turn-1', deltaOffset: offset,
    item: makeAssistantTextItem({ id: 'item-text', threadId: 'thread', turnId: 'turn-1', text, status: 'running' })
  } as RuntimeEventDraft
  offset += text.length
  return draft
}

it('measures a Codex / Pi turn from the prompt reaching the session to what the notifications show on arrival', async () => {
  let clock = 0
  offset = 0
  setHarnessTimingClock(() => clock)
  const root = await mkdtemp(join(tmpdir(), 'kun-session-timing-'))
  const pool = new HarnessAgentPool<HarnessAgent>()
  cleanup.push(() => pool.dispose(), () => rm(root, { recursive: true, force: true }))
  const recorded: RuntimeEventDraft[] = []
  const runTurn = vi.fn(async (_input: unknown, sink: HarnessTurnSink) => {
    // The notification handlers call sink.emit synchronously; the emitter chain behind it is slower.
    clock = 1_000
    void sink.emit([delta()])
    for (let i = 1; i < 10; i += 1) { clock = 1_000 + i * 100; void sink.emit([delta()]) }
    clock = 2_000
    void sink.emit([{
      kind: 'usage', threadId: 'thread', turnId: 'turn-1',
      usage: { promptTokens: 500, completionTokens: 120, totalTokens: 620, cacheHitRate: null, turns: 0 }
    }])
    clock = 90_000 // long after: the persistence queue must not leak into the measurement
    return { status: 'completed' as const }
  })
  const session = (input: HarnessSessionStartInput): HarnessSession => ({
    providerSessionId: 'cx-thread', preparation: input.preparation, replayedHistory: true,
    runTurn, interrupt: vi.fn(async () => undefined), detach: vi.fn()
  }) as unknown as HarnessSession
  const agent = { closed: false, close: vi.fn(async () => undefined), onExit: vi.fn(), sessionThreadIds: () => [], info: {},
    sessionCapabilities: () => ({ continuation: 'native' }),
    startSession: vi.fn(async (input: HarnessSessionStartInput) => session(input)) } as unknown as HarnessAgent
  const definition = { id: 'codex', transport: 'codex-app-server', launch: { command: 'fake-codex' } }
  const items = [makeUserItem({ id: 'user-1', threadId: 'thread', turnId: 'turn-1', text: 'hi' })]
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({
    ok: true,
    ctx: { definition, thread: { id: 'thread' }, turn: { id: 'turn-1' }, workspace: '/repo', poolKey: 'codex:native',
      credentialEnv: {}, secretEnv: {}, credentialIdentity: 'account', model: 'gpt', items,
      userItem: { text: 'hi' }, instructionBlocks: [], redactedRequestValues: [] } as unknown as SessionTurnContext
  })
  const finishTurn = vi.fn(async (_args: unknown) => undefined)
  const runtime = new SessionTurnRuntime({
    transport: 'codex-app-server', providerKind: 'codex-app-server', pool,
    catalog: { get: () => definition }, agentFactory: { connect: vi.fn(async () => agent) },
    readiness: { validateTurn: vi.fn(async () => 'proof'), commandForTurn: () => 'fake-codex' }, capabilities: {}, capabilitiesV2: {},
    sessionCoordinator: new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root)),
    turns: { finishTurn, applyAssistantDelta: vi.fn(async () => undefined), applyItem: vi.fn(async () => undefined), updateItem: vi.fn(async () => undefined) },
    events: { record: vi.fn(async (draft: RuntimeEventDraft) => { recorded.push(draft) }) },
    sessionStore: { loadItems: async () => items }, ids: { next: () => 'id' }
  } as unknown as SessionTurnRuntimeDeps)

  expect(await runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('completed')

  const usage = recorded.find((draft) => draft.kind === 'usage')
  expect(usage && usage.kind === 'usage' && usage.usage).toMatchObject({
    requestTtftMs: 1_000, // prompt handed over at 0, first delta at 1000
    requestGenerationMs: 900, // 9 more deltas, 100 ms apart
    requestGenerationTokens: 90
  })
})
