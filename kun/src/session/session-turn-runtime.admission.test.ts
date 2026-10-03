import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionTurnRuntime, type SessionTurnRuntimeDeps } from './session-turn-runtime.js'
import { HarnessAgentPool } from './harness-pool.js'
import type { HarnessAgent, HarnessSession } from './harness-session.js'
import { resolveSessionTurnContext, type SessionTurnContext } from './session-turn-context.js'

vi.mock('./session-turn-context.js', () => ({ resolveSessionTurnContext: vi.fn() }))
const pools: HarnessAgentPool<HarnessAgent>[] = []
afterEach(async () => { for (const pool of pools.splice(0)) await pool.dispose() })

function fixture() {
  let enabled = true
  const preparation = { resumed: true }
  const session = { providerSessionId: 'session', preparation, replayedHistory: false,
    runTurn: vi.fn(async () => ({ status: 'completed' as const })),
    interrupt: vi.fn(async () => undefined), detach: vi.fn() } as unknown as HarnessSession
  const agent = { closed: false, close: vi.fn(async () => undefined), onExit: vi.fn(),
    sessionThreadIds: () => [], info: {}, sessionCapabilities: () => ({ continuation: 'native' }),
    startSession: vi.fn(async () => session) } as unknown as HarnessAgent
  const pool = new HarnessAgentPool<HarnessAgent>(); pools.push(pool)
  const ctx = { definition: { id: 'pi', transport: 'pi-rpc', launch: { command: 'fake-pi' } },
    thread: { id: 'thread' }, turn: { id: 'turn' }, workspace: '/tmp', poolKey: 'pi:profile',
    credentialEnv: {}, secretEnv: {}, credentialIdentity: 'identity', items: [],
    userItem: { text: 'hello' }, instructionBlocks: [], redactedRequestValues: [] } as unknown as SessionTurnContext
  vi.mocked(resolveSessionTurnContext).mockResolvedValue({ ok: true, ctx })
  const validateTurn = vi.fn(async () => { if (!enabled) throw new Error('profile disabled'); return 'proof' })
  const prepare = vi.fn(async () => preparation)
  const record = vi.fn(async () => undefined)
  const finishTurn = vi.fn(async () => undefined)
  const deps = { transport: 'pi-rpc', providerKind: 'pi-rpc', pool,
    catalog: { get: () => ctx.definition }, agentFactory: { connect: vi.fn(async () => agent) },
    readiness: { validateTurn, commandForTurn: () => 'fake-pi' }, capabilities: {}, capabilitiesV2: {},
    sessionCoordinator: { runExclusive: (_id: string, fn: () => unknown) => fn(), prepare, commit: vi.fn() },
    turns: { finishTurn }, events: { record }, sessionStore: { loadItems: async () => [] }, ids: { next: () => 'id' }
  } as unknown as SessionTurnRuntimeDeps
  return { runtime: new SessionTurnRuntime(deps), agent, session, pool, prepare, record, finishTurn,
    disable: () => { enabled = false }, connect: deps.agentFactory.connect }
}

describe('session runtime last admission boundaries', () => {
  it('rejects a reused process when admission changes during session preparation', async () => {
    const f = fixture()
    const prior = await f.pool.acquire('pi:profile', async () => f.agent); prior.release()
    f.prepare.mockImplementationOnce(async () => { f.disable(); return { resumed: true } })
    expect(await f.runtime.runTurn('thread', 'turn', new AbortController().signal)).toBe('failed')
    expect(f.agent.startSession).not.toHaveBeenCalled()
    expect(f.session.runTurn).not.toHaveBeenCalled()
    expect(f.connect).not.toHaveBeenCalled()
  })
  it('rechecks after asynchronous session setup and before the prompt', async () => {
    const f = fixture()
    vi.mocked(f.agent.startSession).mockImplementationOnce(async () => { f.disable(); return f.session })
    expect(await f.runtime.runTurn('thread', 'turn', new AbortController().signal)).toBe('failed')
    expect(f.session.runTurn).not.toHaveBeenCalled()
    expect(f.session.detach).toHaveBeenCalledOnce()
  })
  it('cancels a queued acquisition before the preceding connection settles', async () => {
    const f = fixture(); const controller = new AbortController()
    let finish!: (agent: HarnessAgent) => void
    const first = f.pool.acquire('pi:profile', () => new Promise((resolve) => { finish = resolve }))
    await vi.waitFor(() => expect(finish).toBeDefined())
    const acquire = vi.spyOn(f.pool, 'acquire')
    const turn = f.runtime.runTurn('thread', 'turn', controller.signal)
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled())
    controller.abort(new Error('cancelled'))
    expect(await turn).toBe('aborted')
    expect(f.agent.startSession).not.toHaveBeenCalled()
    expect(f.session.runTurn).not.toHaveBeenCalled()
    finish(f.agent)
    const lease = await first; lease.release()
    expect(f.connect).not.toHaveBeenCalled()
  })
  it('never prompts when cancelled during the final metadata write', async () => {
    const f = fixture(); const controller = new AbortController()
    f.record.mockImplementationOnce(async () => { controller.abort(new Error('cancelled')) })
    expect(await f.runtime.runTurn('thread', 'turn', controller.signal)).toBe('aborted')
    expect(f.session.runTurn).not.toHaveBeenCalled()
    expect(f.session.detach).toHaveBeenCalledOnce()
  })
})
