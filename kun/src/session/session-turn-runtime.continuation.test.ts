import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionTurnRuntime, type SessionTurnRuntimeDeps } from './session-turn-runtime.js'
import { HarnessAgentPool } from './harness-pool.js'
import { HarnessTransportError, HarnessSessionUnavailableError } from './harness-session.js'
import type { HarnessAgent, HarnessSession, HarnessSessionStartInput, HarnessTurnInput } from './harness-session.js'
import { resolveSessionTurnContext, type SessionTurnContext } from './session-turn-context.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import type { TurnItem } from '../contracts/items.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore } from '../runtime/delegated-session-binding.js'

vi.mock('./session-turn-context.js', () => ({ resolveSessionTurnContext: vi.fn() }))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); vi.restoreAllMocks() })

async function runTwoTurns(models: [string | undefined, string | undefined], extraDeps: Partial<SessionTurnRuntimeDeps> = {}, resumeError?: Error, pendingText = 'Which colour?') {
  const root = await mkdtemp(join(tmpdir(), 'kun-codex-continuation-'))
  const pool = new HarnessAgentPool<HarnessAgent>()
  cleanup.push(() => pool.dispose(), () => rm(root, { recursive: true, force: true }))
  const stored: TurnItem[] = []
  const inputs: HarnessTurnInput[] = []
  const session = (input: HarnessSessionStartInput): HarnessSession => ({
    providerSessionId: 'cx-thread', preparation: input.preparation, replayedHistory: !input.preparation.resumed,
    runTurn: vi.fn(async (turnInput: HarnessTurnInput) => {
      inputs.push(turnInput)
      stored.push(makeAssistantTextItem({ id: `reply-${input.turnId}`, threadId: 'thread', turnId: input.turnId, text: 'ok', status: 'completed' }))
      return { status: 'completed' as const }
    }),
    interrupt: vi.fn(async () => undefined), detach: vi.fn()
  }) as unknown as HarnessSession
  const agent = { closed: false, close: vi.fn(async () => undefined), onExit: vi.fn(), sessionThreadIds: () => [], info: {},
    sessionCapabilities: () => ({ continuation: 'native' }),
    startSession: vi.fn(async (input: HarnessSessionStartInput) => session(input)),
    resumeSession: vi.fn(async (input: HarnessSessionStartInput) => session(input)) } as unknown as HarnessAgent
  const definition = { id: 'codex', transport: 'codex-app-server', launch: { command: 'fake-codex' } }
  const turnContext = (turnId: string, text: string, model: string | undefined): SessionTurnContext => {
    const userItem = makeUserItem({ id: `user-${turnId}`, threadId: 'thread', turnId, text })
    stored.push(userItem)
    return { definition, thread: { id: 'thread' }, turn: { id: turnId }, workspace: '/repo', poolKey: 'codex:native',
      credentialEnv: {}, secretEnv: {}, credentialIdentity: 'account', model, items: [...stored],
      userItem, instructionBlocks: ['Host policy'], redactedRequestValues: [] } as unknown as SessionTurnContext
  }
  const events = { record: vi.fn(async (_draft: { kind: string }) => undefined) }
  const deps = { transport: 'codex-app-server', providerKind: 'codex-app-server', pool,
    catalog: { get: () => definition }, agentFactory: { connect: vi.fn(async () => agent) },
    readiness: { validateTurn: vi.fn(async () => 'proof'), commandForTurn: () => 'fake-codex' }, capabilities: {}, capabilitiesV2: {},
    sessionCoordinator: new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root)),
    turns: { finishTurn: vi.fn(async () => undefined) }, events,
    sessionStore: { loadItems: async () => [...stored] }, ids: { next: () => 'id' },
    ...extraDeps
  } as unknown as SessionTurnRuntimeDeps
  const runtime = new SessionTurnRuntime(deps)

  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: turnContext('turn-1', 'Remember blue', models[0]) })
  expect(await runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('completed')
  if (resumeError) vi.mocked(agent.resumeSession!).mockRejectedValueOnce(resumeError)
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: turnContext('turn-2', pendingText, models[1]) })
  expect(await runtime.runTurn('thread', 'turn-2', new AbortController().signal))
    .toBe(resumeError && !(resumeError instanceof HarnessSessionUnavailableError) ? 'failed' : 'completed')
  return { agent, events, runtime, turnContext, inputs, stored, coordinator: deps.sessionCoordinator! }
}

it.each([
  new HarnessTransportError('request_timeout', 'resume timed out'),
  new HarnessTransportError('connection_closed', 'transport closed'),
  new HarnessTransportError('harness_not_ready', 'configuration unavailable'),
  new HarnessTransportError('harness_protocol_error', 'invalid response'),
  new HarnessTransportError('request_aborted', 'cancelled'),
  new HarnessTransportError('agent_error', 'server overloaded', { code: -32001 }),
  new Error('unknown failure')
])('preserves the native binding after %s and resumes it on a later turn', async (error) => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const h = await runTwoTurns(['model', 'model'], {}, error)
  expect(h.agent.startSession).toHaveBeenCalledOnce()
  expect(await h.coordinator.store.load('thread')).toMatchObject({ generation: 1, nativeSessionId: 'cx-thread' })
  expect(h.events.record.mock.calls.map(([draft]) => draft.kind)).not.toContain('handoff_injected')
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: h.turnContext('turn-3', 'Retry', 'model') })
  expect(await h.runtime.runTurn('thread', 'turn-3', new AbortController().signal)).toBe('completed')
  expect(h.agent.startSession).toHaveBeenCalledOnce()
  expect(h.agent.resumeSession).toHaveBeenCalledTimes(2)
  expect(vi.mocked(h.agent.resumeSession!).mock.calls[1]![0].preparation).toMatchObject({
    generation: 1, resumed: true, nativeSessionId: 'cx-thread', pendingUserMessages: [expect.objectContaining({ text: 'Which colour?' })]
  })
  expect(h.inputs[1]!.userText).toContain('Which colour?')
  expect(h.events.record.mock.calls.map(([draft]) => draft.kind)).not.toContain('handoff_injected')
})

it('only rebases an explicitly unavailable native session and redacts diagnostics', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const error = new HarnessSessionUnavailableError('missing session',
    new HarnessTransportError('agent_error', 'no such thread Authorization: Bearer kun_private_token', { code: -32602, secret: 'private-data' }))
  const h = await runTwoTurns(['model', 'model'], {}, error)
  expect(h.agent.startSession).toHaveBeenCalledTimes(2)
  expect(vi.mocked(h.agent.startSession).mock.calls[1]![0].preparation).toMatchObject({ generation: 2, rebaseReason: 'native_state_unavailable' })
  const log = JSON.stringify(warn.mock.calls)
  expect(log).toContain('rpcCode')
  expect(log).toContain('-32602')
  expect(log).not.toContain('kun_private_token')
  expect(log).not.toContain('private-data')
})

it('resumes the same native Codex thread on a follow-up turn instead of handing off', async () => {
  const { agent } = await runTwoTurns(['gpt-6.1-sol', 'gpt-6.1-sol'])
  expect(agent.startSession).toHaveBeenCalledOnce()
  expect(agent.resumeSession).toHaveBeenCalledOnce()
  expect(vi.mocked(agent.resumeSession!).mock.calls[0]![0].preparation).toMatchObject({ resumed: true, nativeSessionId: 'cx-thread' })
})

it('keeps the native Codex thread when only the model changes, applies the new model and sends no handoff', async () => {
  const { agent, events } = await runTwoTurns(['deepseek-flash', 'auto_tmkz6q781c'])
  expect(agent.startSession).toHaveBeenCalledOnce()
  expect(agent.resumeSession).toHaveBeenCalledOnce()
  const resumed = vi.mocked(agent.resumeSession!).mock.calls[0]![0]
  expect(resumed.preparation).toMatchObject({ resumed: true, nativeSessionId: 'cx-thread' })
  expect(resumed.preparation.rebaseReason).toBeUndefined()
  expect(resumed.model).toBe('auto_tmkz6q781c')
  expect(events.record.mock.calls.map(([draft]) => draft.kind)).not.toContain('handoff_injected')
})

it('starts a fresh Codex thread when the model goes back to the Agent default', async () => {
  const { agent } = await runTwoTurns(['deepseek-flash', undefined])
  expect(agent.startSession).toHaveBeenCalledTimes(2)
  expect(agent.resumeSession).not.toHaveBeenCalled()
  expect(vi.mocked(agent.startSession).mock.calls[1]![0].preparation).toMatchObject({ resumed: false, rebaseReason: 'route_changed' })
})

it.each([true, false])('replays all undelivered requests verbatim, excluding queued turns (handoff=%s)', async (deterministicHandoff) => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const firstPending = `${'Details to preserve. '.repeat(700)}\nDo not delete the original data.`
  const h = await runTwoTurns(['model', 'model'], { deterministicHandoff }, new Error('temporarily unavailable'), firstPending)
  const secondPending = `${'More requirements. '.repeat(600)}\nNever publish these changes.`
  vi.mocked(h.agent.resumeSession!).mockRejectedValueOnce(new Error('still unavailable'))
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: h.turnContext('turn-3', secondPending, 'model') })
  expect(await h.runtime.runTurn('thread', 'turn-3', new AbortController().signal)).toBe('failed')
  const current = h.turnContext('turn-4', 'Retry both requests', 'model')
  const queued = h.turnContext('turn-5', 'FUTURE_QUEUED_REQUEST', 'model')
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: { ...current, items: [...h.stored] } })
  expect(await h.runtime.runTurn('thread', 'turn-4', new AbortController().signal)).toBe('completed')
  const delivered = h.inputs[1]!
  expect(delivered.userText).toContain(firstPending)
  expect(delivered.userText).toContain(secondPending)
  expect(delivered.userText.indexOf(firstPending)).toBeLessThan(delivered.userText.indexOf(secondPending))
  expect(delivered.userText.indexOf(secondPending)).toBeLessThan(delivered.userText.indexOf('Current user request:'))
  expect(delivered.userText).not.toContain('FUTURE_QUEUED_REQUEST')
  expect(delivered.handoffBrief).toBeUndefined()
  expect(delivered.historyTranscript).toBeUndefined()
  expect(h.agent.startSession).toHaveBeenCalledOnce()
  expect(await h.coordinator.store.load('thread')).toMatchObject({ generation: 1, nativeSessionId: 'cx-thread' })
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: { ...queued, items: [...h.stored] } })
  expect(await h.runtime.runTurn('thread', 'turn-5', new AbortController().signal)).toBe('completed')
  expect(h.inputs[2]!.userText).toBe('FUTURE_QUEUED_REQUEST')
  expect(h.agent.startSession).toHaveBeenCalledOnce()
})

it('hands Codex the Kun Tools server every turn and revokes each turn grant when it ends', async () => {
  const servers = vi.fn(() => [{ type: 'http', name: 'kun-tools', url: 'http://k/mcp/kun', headers: [] }])
  const revokeTurn = vi.fn()
  const kunToolsMcp = { canDeliver: () => true, servers, revokeTurn }
  const { agent } = await runTwoTurns(['gpt-6.1-sol', 'gpt-6.1-sol'], { kunToolsMcp } as never)
  expect(vi.mocked(agent.startSession).mock.calls[0]![0].kunToolServers).toHaveLength(1)
  expect(vi.mocked(agent.resumeSession!).mock.calls[0]![0].kunToolServers).toHaveLength(1)
  const calls = servers.mock.calls as unknown as Array<[{ turnId: string; sessionKey: string }]>
  expect(calls.map(([input]) => input.turnId)).toEqual(['turn-1', 'turn-2'])
  // One stable descriptor per Kun thread, so a resumed native thread keeps working.
  expect(new Set(calls.map(([input]) => input.sessionKey))).toEqual(new Set(['session-turn:thread']))
  expect(revokeTurn.mock.calls).toEqual([['turn-1'], ['turn-2']])
})
