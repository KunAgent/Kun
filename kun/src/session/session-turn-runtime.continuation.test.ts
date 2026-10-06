import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionTurnRuntime, type SessionTurnRuntimeDeps } from './session-turn-runtime.js'
import { HarnessAgentPool } from './harness-pool.js'
import type { HarnessAgent, HarnessSession, HarnessSessionStartInput } from './harness-session.js'
import { resolveSessionTurnContext, type SessionTurnContext } from './session-turn-context.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import type { TurnItem } from '../contracts/items.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore } from '../runtime/delegated-session-binding.js'

vi.mock('./session-turn-context.js', () => ({ resolveSessionTurnContext: vi.fn() }))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })

it('resumes the same native Codex thread on a follow-up turn instead of handing off', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-codex-continuation-'))
  const pool = new HarnessAgentPool<HarnessAgent>()
  cleanup.push(() => pool.dispose(), () => rm(root, { recursive: true, force: true }))
  const stored: TurnItem[] = []
  const session = (input: HarnessSessionStartInput): HarnessSession => ({
    providerSessionId: 'cx-thread', preparation: input.preparation, replayedHistory: !input.preparation.resumed,
    runTurn: vi.fn(async () => {
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
  const turnContext = (turnId: string, text: string): SessionTurnContext => {
    stored.push(makeUserItem({ id: `user-${turnId}`, threadId: 'thread', turnId, text }))
    return { definition, thread: { id: 'thread' }, turn: { id: turnId }, workspace: '/repo', poolKey: 'codex:native',
      credentialEnv: {}, secretEnv: {}, credentialIdentity: 'account', model: 'gpt-6.1-sol', items: [...stored],
      userItem: { text }, instructionBlocks: ['Host policy'], redactedRequestValues: [] } as unknown as SessionTurnContext
  }
  const deps = { transport: 'codex-app-server', providerKind: 'codex-app-server', pool,
    catalog: { get: () => definition }, agentFactory: { connect: vi.fn(async () => agent) },
    readiness: { validateTurn: vi.fn(async () => 'proof'), commandForTurn: () => 'fake-codex' }, capabilities: {}, capabilitiesV2: {},
    sessionCoordinator: new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root)),
    turns: { finishTurn: vi.fn(async () => undefined) }, events: { record: vi.fn(async () => undefined) },
    sessionStore: { loadItems: async () => [...stored] }, ids: { next: () => 'id' }
  } as unknown as SessionTurnRuntimeDeps
  const runtime = new SessionTurnRuntime(deps)

  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: turnContext('turn-1', 'Remember blue') })
  expect(await runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('completed')
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({ ok: true, ctx: turnContext('turn-2', 'Which colour?') })
  expect(await runtime.runTurn('thread', 'turn-2', new AbortController().signal)).toBe('completed')

  expect(agent.startSession).toHaveBeenCalledOnce()
  expect(agent.resumeSession).toHaveBeenCalledOnce()
  expect(vi.mocked(agent.resumeSession!).mock.calls[0]![0].preparation).toMatchObject({ resumed: true, nativeSessionId: 'cx-thread' })
})
