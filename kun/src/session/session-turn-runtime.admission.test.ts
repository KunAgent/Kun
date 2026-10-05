import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionTurnRuntime, type SessionTurnRuntimeDeps } from './session-turn-runtime.js'
import { HarnessAgentPool } from './harness-pool.js'
import type { HarnessAgent, HarnessSession } from './harness-session.js'
import { resolveSessionTurnContext, type SessionTurnContext } from './session-turn-context.js'
import { makeAssistantTextItem } from '../domain/item.js'

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
    ctx, disable: () => { enabled = false }, connect: deps.agentFactory.connect, deps }
}

describe('session runtime last admission boundaries', () => {
  it('waits for native output persistence before committing continuation or completing the turn', async () => {
    const f = fixture()
    let release!: () => void
    const pendingWrite = new Promise<void>((resolve) => { release = resolve })
    const applyItem = vi.fn(async () => pendingWrite)
    Object.assign(f.deps.turns, { applyItem })
    vi.mocked(f.session.runTurn).mockImplementation(async (_input, sink) => {
      void sink.emit([{ kind: 'item_created', threadId: 'thread', turnId: 'turn',
        item: makeAssistantTextItem({ id: 'answer', threadId: 'thread', turnId: 'turn', text: 'reply', status: 'completed' }) }])
      return { status: 'completed' }
    })
    const running = f.runtime.runTurn('thread', 'turn', new AbortController().signal)
    await vi.waitFor(() => expect(applyItem).toHaveBeenCalledOnce())
    expect(f.deps.sessionCoordinator!.commit).not.toHaveBeenCalled()
    expect(f.finishTurn).not.toHaveBeenCalled()
    release()
    expect(await running).toBe('completed')
    expect(f.deps.sessionCoordinator!.commit).toHaveBeenCalledOnce()
    expect(f.finishTurn).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })
  it('separates native Codex instructions from turn-local user context', async () => {
    const f = fixture()
    f.ctx.definition = { ...f.ctx.definition, id: 'codex' }
    f.ctx.instructionBlocks = ['Stable host policy', 'Current user persona']
    f.ctx.turnDynamicContext = { instructions: ['Current user persona'], blocks: [], privateValues: [], historyItems: [] }
    expect(await f.runtime.runTurn('thread', 'turn', new AbortController().signal)).toBe('completed')
    const setup = vi.mocked(f.agent.startSession).mock.calls[0][0]
    expect(setup.systemInstructions).toContain('Stable host policy')
    expect(setup.systemInstructions).not.toContain('Current user persona')
    const prompt = vi.mocked(f.session.runTurn).mock.calls[0][0]
    expect(prompt.instructionBlocks).toEqual(['Current user persona'])
    expect(prompt.userText).toBe('hello')
  })
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
