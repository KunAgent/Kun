import { describe, expect, it } from 'vitest'
import type { JsonlTransport } from '../../session/jsonl-transport.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import type { HarnessSessionStartInput } from '../../session/harness-session.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'
import { PiAgent } from './pi-agent.js'
import { PiClient } from './pi-client.js'

// ---- fakes ---------------------------------------------------------------------

function fakeTransport() {
  const frames: ((value: unknown, raw: string) => void)[] = []
  const writes: unknown[] = []
  const transport = {
    closed: false,
    onFrame: (h: (value: unknown, raw: string) => void) => {
      frames.push(h)
      return () => undefined
    },
    onClose: () => () => undefined,
    write: (value: unknown) => {
      writes.push(value)
      return Promise.resolve()
    }
  } as unknown as JsonlTransport
  return {
    transport,
    writes,
    emit: (value: unknown) =>
      frames.forEach((h) => h(value, JSON.stringify(value)))
  }
}

function fakeProcess(): HarnessProcess {
  return {
    stdin: undefined,
    stdout: undefined,
    exit: new Promise(() => undefined),
    stderrTail: () => '',
    sanitizedStderrTail: () => '',
    stop: () => Promise.resolve()
  } as unknown as HarnessProcess
}

function respond(writes: unknown[], emit: (v: unknown) => void, data?: Record<string, unknown>): void {
  const req = writes.at(-1) as { id: string; type: string }
  emit({ id: req.id, type: 'response', command: req.type, success: true, data })
}

function failLast(writes: unknown[], emit: (v: unknown) => void, error: string): void {
  const req = writes.at(-1) as { id: string; type: string }
  emit({ id: req.id, type: 'response', command: req.type, success: false, error })
}

const CONNECT_INPUT = {
  definition: {} as never,
  command: 'pi',
  args: ['--mode', 'rpc'],
  env: {},
  secretEnv: {},
  credentialEnv: {},
  stripEnv: [],
  cwd: '/repo',
  signal: new AbortController().signal
}

function sessionInput(
  overrides: Partial<HarnessSessionStartInput> = {}
): HarnessSessionStartInput {
  const preparation: DelegatedSessionPreparation = {
    threadId: 'kun-thread-1',
    generation: 1,
    route: {
      providerKind: 'pi-rpc',
      providerId: 'pi',
      model: 'deepseek/deepseek-chat',
      credentialIdentity: 'native',
      workspace: '/repo',
      capabilityFingerprint: 'fp',
      continuationMode: 'native'
    },
    priorHistoryDigest: '',
    resumed: false
  }
  return {
    threadId: 'kun-thread-1',
    turnId: 'kun-turn-1',
    workspacePath: '/repo',
    harnessId: 'pi',
    model: 'deepseek/deepseek-chat',
    items: [],
    preparation,
    signal: new AbortController().signal,
    ...overrides
  }
}

async function setup() {
  const { transport, writes, emit } = fakeTransport()
  const proc = fakeProcess()
  const client = new PiClient(proc, { transport })
  const agent = await PiAgent.connect(CONNECT_INPUT, { client, process: proc })
  return { agent, client, writes, emit }
}

describe('PiAgent', () => {
  it('binds a session: set_model (provider/id split) then get_state', async () => {
    const { agent, writes, emit } = await setup()
    const promise = agent.startSession(sessionInput())
    await new Promise((r) => setImmediate(r))
    const setModel = writes.at(-1) as { type: string; provider: string; modelId: string }
    expect(setModel.type).toBe('set_model')
    expect(setModel.provider).toBe('deepseek')
    expect(setModel.modelId).toBe('deepseek-chat')
    respond(writes, emit, {})
    await new Promise((r) => setImmediate(r))
    const getState = writes.at(-1) as { type: string }
    expect(getState.type).toBe('get_state')
    respond(writes, emit, { sessionFile: '/sessions/s1.jsonl' })
    const session = await promise
    expect(session.providerSessionId).toBe('/sessions/s1.jsonl')
    expect(agent.sessionThreadIds()).toEqual(['kun-thread-1'])
  })

  it('skips set_model when the session has no model', async () => {
    const { agent, writes, emit } = await setup()
    const promise = agent.startSession(sessionInput({ model: undefined }))
    await new Promise((r) => setImmediate(r))
    expect((writes.at(-1) as { type: string }).type).toBe('get_state')
    respond(writes, emit, { sessionFile: '/s.jsonl' })
    await promise
  })

  it('resumes via switch_session with the stored session file', async () => {
    const { agent, writes, emit } = await setup()
    const promise = agent.resumeSession(
      sessionInput({
        model: undefined,
        preparation: {
          ...sessionInput().preparation,
          resumed: true,
          nativeSessionId: '/sessions/old.jsonl'
        }
      })
    )
    await new Promise((r) => setImmediate(r))
    const req = writes.at(-1) as { type: string; sessionPath: string }
    expect(req.type).toBe('switch_session')
    expect(req.sessionPath).toBe('/sessions/old.jsonl')
    respond(writes, emit, {})
    await new Promise((r) => setImmediate(r))
    respond(writes, emit, { sessionFile: '/sessions/old.jsonl' })
    const session = await promise
    expect(session.providerSessionId).toBe('/sessions/old.jsonl')
    expect(session.replayedHistory).toBe(false)
  })

  it('surfaces resume failures as harness_not_ready for portable rebase', async () => {
    const { agent, writes, emit } = await setup()
    const promise = agent.resumeSession(
      sessionInput({
        model: undefined,
        preparation: {
          ...sessionInput().preparation,
          resumed: true,
          nativeSessionId: '/sessions/dead.jsonl'
        }
      })
    )
    await new Promise((r) => setImmediate(r))
    failLast(writes, emit, 'no such session file')
    await expect(promise).rejects.toMatchObject({
      name: 'HarnessTransportError',
      code: 'harness_not_ready'
    })
  })

  it('treats switch_session veto as not-ready', async () => {
    const { agent, writes, emit } = await setup()
    const promise = agent.resumeSession(
      sessionInput({
        model: undefined,
        preparation: {
          ...sessionInput().preparation,
          resumed: true,
          nativeSessionId: '/sessions/veto.jsonl'
        }
      })
    )
    await new Promise((r) => setImmediate(r))
    respond(writes, emit, { cancelled: true })
    await expect(promise).rejects.toMatchObject({ code: 'harness_not_ready' })
  })

  it('lists models as provider/id pairs', async () => {
    const { agent, writes, emit } = await setup()
    const promise = agent.listModels()
    respond(writes, emit, {
      models: [
        { provider: 'deepseek', id: 'deepseek-chat' },
        { provider: 'kun', id: 'kun/deepseek/deepseek-chat' }
      ]
    })
    await expect(promise).resolves.toEqual([
      'deepseek/deepseek-chat',
      'kun/kun/deepseek/deepseek-chat'
    ])
  })

  it('exposes native continuation fingerprint', async () => {
    const { agent } = await setup()
    expect(agent.sessionCapabilities().continuation).toBe('native')
  })
})
