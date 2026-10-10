import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionTurnRuntime, type SessionTurnRuntimeDeps } from './session-turn-runtime.js'
import { HarnessAgentPool } from './harness-pool.js'
import type { HarnessAgent, HarnessSession, HarnessSessionStartInput, HarnessTurnInput, HarnessTurnResult } from './harness-session.js'
import { HarnessTransportError } from './harness-session.js'
import { resolveSessionTurnContext, type SessionTurnContext } from './session-turn-context.js'
import { makeUserItem } from '../domain/item.js'
import type { SteeringEntry } from '../contracts/turns.js'
import type { DelegatedSteering } from '../services/delegated-steering.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore } from '../runtime/delegated-session-binding.js'

vi.mock('./session-turn-context.js', () => ({ resolveSessionTurnContext: vi.fn() }))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

function guidance() {
  const pending: SteeringEntry[] = []
  const listeners = new Set<() => void>()
  const state = { opened: 0, sealed: false }
  const steering: DelegatedSteering = {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    take: async () => pending.splice(0),
    sealIfEmpty: () => (state.sealed = pending.length === 0)
  }
  return {
    state,
    admit(text: string, notify = true) {
      pending.push({ text })
      if (notify) for (const listener of [...listeners]) listener()
    },
    turns: { openDelegatedSteering: () => { state.opened += 1; return steering } }
  }
}

async function harness(options: {
  supported: boolean
  withSteer: boolean
  steer?: (text: string, call: number) => Promise<void>
  run: (input: HarnessTurnInput, run: number) => Promise<HarnessTurnResult>
  guide: ReturnType<typeof guidance>
}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-session-steer-'))
  const pool = new HarnessAgentPool<HarnessAgent>()
  cleanup.push(() => pool.dispose(), () => rm(root, { recursive: true, force: true }))
  const inputs: HarnessTurnInput[] = []
  const steered: string[] = []
  let runs = 0
  const session = (start: HarnessSessionStartInput): HarnessSession => ({
    providerSessionId: 'native-1', preparation: start.preparation, replayedHistory: false,
    runTurn: vi.fn(async (input: HarnessTurnInput) => { inputs.push(input); return options.run(input, ++runs) }),
    interrupt: vi.fn(async () => undefined), detach: vi.fn(),
    ...(options.withSteer ? { steer: vi.fn(async (text: string) => {
      steered.push(text)
      await options.steer?.(text, steered.length)
    }) } : {})
  }) as unknown as HarnessSession
  const agent = { closed: false, close: vi.fn(async () => undefined), onExit: vi.fn(), sessionThreadIds: () => [], info: {},
    sessionCapabilities: () => ({ continuation: 'native' }),
    startSession: vi.fn(async (start: HarnessSessionStartInput) => session(start)) } as unknown as HarnessAgent
  const definition = { id: 'codex', transport: 'codex-app-server', launch: { command: 'fake-codex' } }
  const items = [makeUserItem({ id: 'user-1', threadId: 'thread', turnId: 'turn-1', text: 'hi' })]
  vi.mocked(resolveSessionTurnContext).mockResolvedValueOnce({
    ok: true,
    ctx: { definition, thread: { id: 'thread' }, turn: { id: 'turn-1' }, workspace: '/repo', poolKey: 'codex:native',
      credentialEnv: {}, secretEnv: {}, credentialIdentity: 'account', model: 'gpt', items,
      userItem: { text: 'hi' }, instructionBlocks: ['stay in the repo'], redactedRequestValues: [] } as unknown as SessionTurnContext
  })
  const finished: Array<{ status: string }> = []
  const runtime = new SessionTurnRuntime({
    transport: 'codex-app-server', providerKind: 'codex-app-server', pool,
    catalog: { get: () => definition }, agentFactory: { connect: vi.fn(async () => agent) },
    readiness: { validateTurn: vi.fn(async () => 'proof'), commandForTurn: () => 'fake-codex' }, capabilities: {},
    capabilitiesV2: { statuses: { sameTurnSteer: { supported: options.supported } } },
    sessionCoordinator: new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root)),
    turns: { finishTurn: async (args: { status: string }) => { finished.push(args) }, applyAssistantDelta: vi.fn(async () => undefined),
      applyItem: vi.fn(async () => undefined), updateItem: vi.fn(async () => undefined), ...options.guide.turns },
    events: { record: vi.fn(async () => undefined) },
    sessionStore: { loadItems: async () => items }, ids: { next: () => 'id' }
  } as unknown as SessionTurnRuntimeDeps)
  return { runtime, inputs, steered, finished }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const completed = async (): Promise<HarnessTurnResult> => ({ status: 'completed' })

describe('SessionTurnRuntime live guidance', () => {
  it('delivers guidance admitted during the run to the engine and seals when drained', async () => {
    const guide = guidance()
    const h = await harness({ supported: true, withSteer: true, guide, run: async () => {
      guide.admit('also allow 5-1')
      await tick()
      await tick()
      return completed()
    } })
    expect(await h.runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('completed')
    expect(h.steered).toEqual(['also allow 5-1'])
    expect(h.inputs).toHaveLength(1)
    expect(guide.state).toEqual({ opened: 1, sealed: true })
  })

  it('answers guidance the engine refused with a follow-up run of the same turn', async () => {
    const guide = guidance()
    const h = await harness({
      supported: true, withSteer: true, guide,
      steer: async () => { throw new HarnessTransportError('harness_not_ready', 'run ended') },
      run: async (_input, run) => {
        if (run === 1) { guide.admit('one more thing'); await tick(); await tick() }
        return completed()
      }
    })
    expect(await h.runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('completed')
    expect(h.inputs).toHaveLength(2)
    expect(h.inputs[1]).toMatchObject({ userText: 'one more thing', instructionBlocks: [], images: [], attachmentPaths: [] })
    expect(h.inputs[0]?.userText).toBe('hi')
    expect(h.finished.map((entry) => entry.status)).toEqual(['completed'])
    expect(guide.state.sealed).toBe(true)
  })

  it('runs guidance that arrived after the last delivery as a follow-up', async () => {
    const guide = guidance()
    const h = await harness({ supported: true, withSteer: true, guide, run: async (_input, run) => {
      if (run === 1) {
        await tick()
        await tick()
        guide.admit('too late to signal', false)
      }
      return completed()
    } })
    expect(await h.runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('completed')
    expect(h.steered).toEqual([])
    expect(h.inputs.map((input) => input.userText)).toEqual(['hi', 'too late to signal'])
  })

  it('does not send late guidance after a failed run', async () => {
    const guide = guidance()
    const h = await harness({ supported: true, withSteer: true, guide, run: async () => {
      guide.admit('after the failure', false)
      return { status: 'failed', message: 'boom' }
    } })
    expect(await h.runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('failed')
    expect(h.inputs).toHaveLength(1)
    expect(guide.state.sealed).toBe(true)
  })

  it('leaves steering closed when the engine cannot steer', async () => {
    for (const options of [{ supported: false, withSteer: true }, { supported: true, withSteer: false }]) {
      const guide = guidance()
      const h = await harness({ ...options, guide, run: completed })
      expect(await h.runtime.runTurn('thread', 'turn-1', new AbortController().signal)).toBe('completed')
      expect(guide.state.opened).toBe(0)
      expect(h.inputs).toHaveLength(1)
    }
  })
})
