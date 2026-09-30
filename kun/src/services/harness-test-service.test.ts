import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { runHarnessTest, withTimeout } from './harness-test-service.js'
import { ACP_DEFAULT_CAPABILITIES } from '../harness/builtin-harnesses.js'
import type { HarnessDefinition, HarnessId, HarnessStatus } from '../contracts/harness.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { AcpSpawnFn } from '../runtime/acp/acp-process.js'

const FIXTURE_AGENT = fileURLToPath(
  new URL('../runtime/acp/__fixtures__/fake-acp-agent.mjs', import.meta.url)
)
const SCENARIOS = fileURLToPath(
  new URL('../runtime/acp/__fixtures__/scenarios/', import.meta.url)
)

const spawnAgent: AcpSpawnFn = async (command, args, options) =>
  spawn(command, [...args], {
    env: options.env as NodeJS.ProcessEnv,
    stdio: options.stdio as ['pipe', 'pipe', 'pipe'],
    cwd: options.cwd
  })

function acpDefinition(scenario: string): HarnessDefinition {
  return {
    id: 'fake-acp' as HarnessId,
    displayName: 'Fake ACP',
    transport: 'acp',
    launch: {
      command: process.execPath,
      args: [FIXTURE_AGENT],
      env: { FAKE_ACP_SCENARIO: `${SCENARIOS}${scenario}` }
    },
    credentialModes: ['native-login'],
    permissionModes: [
      { id: 'default', label: 'Default', kunPermissionMode: 'ask-for-approval' }
    ],
    modelSource: 'static',
    staticModels: [],
    capabilities: ACP_DEFAULT_CAPABILITIES,
    builtin: true
  }
}

function cliDefinition(): HarnessDefinition {
  return {
    ...acpDefinition('basic-chat.json'),
    id: 'fake-cli' as HarnessId,
    transport: 'antigravity-cli',
    launch: undefined
  }
}

const DETECTED: HarnessStatus = {
  harnessId: 'fake-acp',
  installed: 'yes',
  version: '1.0.0',
  login: 'signed-in',
  // The handshake probe spawns this — point it at the real node binary.
  resolvedCommand: process.execPath,
  checkedAt: new Date(0).toISOString()
}

type TrialFakes = {
  threadService: {
    create: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  turnService: {
    startTurn: ReturnType<typeof vi.fn>
    getTurn: ReturnType<typeof vi.fn>
    interruptTurn: ReturnType<typeof vi.fn>
  }
  created: { request: Record<string, unknown>; options: Record<string, unknown> }[]
  workspaces: string[]
}

function trialFakes(options: {
  turnStatus?: string
  outcome?: string
  usage?: boolean
  hang?: boolean
} = {}): TrialFakes {
  const created: TrialFakes['created'] = []
  const workspaces: string[] = []
  return {
    created,
    workspaces,
    threadService: {
      create: vi.fn(async (request: Record<string, unknown>, opts: Record<string, unknown>) => {
        created.push({ request, options: opts })
        workspaces.push(request.workspace as string)
        return { id: 'thr-test' }
      }),
      delete: vi.fn(async () => {})
    },
    turnService: {
      startTurn: vi.fn(async () => ({ threadId: 'thr-test', turnId: 'turn-1' })),
      getTurn: vi.fn(async () => (options.turnStatus === undefined ? null : {
        status: options.turnStatus,
        error: options.turnStatus === 'failed' ? 'harness exploded' : undefined,
        terminalCode: options.turnStatus === 'failed' ? 'harness_turn_failed' : undefined
      })),
      interruptTurn: vi.fn(async () => ({ status: 'aborted' }))
    }
  }
}

function runtimeWith(
  definition: HarnessDefinition,
  overrides: Partial<ServerRuntime> = {},
  fakes?: TrialFakes
): ServerRuntime {
  return {
    harnesses: {
      catalog: { get: (id: string) => (id === definition.id ? definition : undefined) },
      detector: {
        status: vi.fn(async () => DETECTED),
        cachedStatus: () => DETECTED,
        detecting: () => false,
        peek: () => DETECTED
      }
    },
    threadService: fakes?.threadService,
    turnService: fakes?.turnService,
    sessionStore: { loadEventsSince: async () => [] },
    runTurn: overrides.runTurn,
    defaultModel: 'default-model',
    ...overrides
  } as unknown as ServerRuntime
}

describe('runHarnessTest', () => {
  it('returns an unconfirmed timeout when a harness interrupt never acknowledges', async () => {
    vi.useFakeTimers()
    try {
      const result = withTimeout(new Promise<never>(() => undefined), 100, () =>
        new Promise<void>(() => undefined))
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(result).resolves.toBe('timeout_unconfirmed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('detect level returns the fresh detection verdict', async () => {
    const definition = acpDefinition('basic-chat.json')
    const result = await runHarnessTest(
      runtimeWith(definition),
      definition,
      { level: 'detect' }
    )
    expect(result.ok).toBe(true)
    expect(result.detect.ok).toBe(true)
    expect(result.detect.status.resolvedCommand).toBe(process.execPath)
    expect(result.handshake).toBeUndefined()
    expect(result.trial).toBeUndefined()
  })

  it('stops after a failed detect instead of probing deeper levels', async () => {
    const definition = acpDefinition('basic-chat.json')
    const runtime = runtimeWith(definition)
    runtime.harnesses!.detector.status = vi.fn(async () => ({
      ...DETECTED,
      installed: 'no' as const,
      resolvedCommand: undefined
    }))
    const result = await runHarnessTest(runtime, definition, { level: 'trial' })
    expect(result.ok).toBe(false)
    expect(result.detect.ok).toBe(false)
    expect(result.handshake).toBeUndefined()
    expect(result.trial).toBeUndefined()
  })

  it('handshake level exposes ACP agent info and capabilities', async () => {
    const definition = acpDefinition('basic-chat.json')
    const result = await runHarnessTest(
      runtimeWith(definition),
      definition,
      { level: 'handshake' }
    )
    expect(result.ok).toBe(true)
    expect(result.handshake?.supported).toBe(true)
    expect(result.handshake?.protocolVersion).toBe(1)
    expect(result.handshake?.agent).toEqual({ name: 'fake-acp-agent', version: '0.0.1' })
    expect(result.handshake?.capabilities).toMatchObject({
      sessionResume: true,
      imageInput: true,
      mcpTransports: ['http']
    })
  })

  it('handshake level reports the failure detail when initialize fails', async () => {
    const definition = acpDefinition('does-not-exist.json')
    const result = await runHarnessTest(
      runtimeWith(definition),
      definition,
      { level: 'handshake' }
    )
    expect(result.ok).toBe(false)
    expect(result.handshake?.ok).toBe(false)
    expect(result.handshake?.detail).toBeTruthy()
  })

  it('reports handshake as unsupported for cli transports without failing', async () => {
    const definition = cliDefinition()
    const result = await runHarnessTest(
      runtimeWith(definition),
      definition,
      { level: 'handshake' }
    )
    expect(result.ok).toBe(true)
    expect(result.handshake?.supported).toBe(false)
  })

  it('trial runs a real turn on a hidden side thread and deletes it', async () => {
    const fakes = trialFakes({ turnStatus: 'completed', outcome: 'completed' })
    const definition = acpDefinition('basic-chat.json')
    const runtime = runtimeWith(definition, {
      runTurn: async () => 'completed',
      sessionStore: {
        loadEventsSince: async () => [
          {
            kind: 'usage',
            turnId: 'turn-1',
            usage: { totalTokens: 42, promptTokens: 30, completionTokens: 12 },
            model: 'fake-model-1',
            providerId: 'kun'
          }
        ]
      }
    } as unknown as ServerRuntime, fakes)
    const result = await runHarnessTest(runtime, definition, { level: 'trial' })
    expect(result.ok).toBe(true)
    expect(result.trial?.status).toBe('completed')
    expect(result.trial?.usage?.totalTokens).toBe(42)
    // The trial thread is a `side` relation — filtered out of conversation
    // lists — and is deleted after the run either way.
    expect(fakes.created[0]?.options.relation).toBe('side')
    expect(fakes.created[0]?.request.titleAuto).toBe(false)
    expect(fakes.threadService.delete).toHaveBeenCalledWith('thr-test')
    for (const dir of fakes.workspaces) expect(existsSync(dir)).toBe(false)
    const turnRequest = fakes.turnService.startTurn.mock.calls[0]?.[0]?.request
    expect(turnRequest).toMatchObject({
      harnessId: 'fake-acp',
      mode: 'agent',
      clientSurface: 'api',
      disableUserInput: true,
      approvalPolicy: 'never',
      sandboxMode: 'read-only'
    })
  })

  it('trial reports the turn failure and still cleans up the thread', async () => {
    const fakes = trialFakes({ turnStatus: 'failed', outcome: 'failed' })
    const definition = acpDefinition('basic-chat.json')
    const runtime = runtimeWith(definition, {
      runTurn: async () => 'failed'
    } as unknown as ServerRuntime, fakes)
    const result = await runHarnessTest(runtime, definition, { level: 'trial' })
    expect(result.ok).toBe(false)
    expect(result.trial?.status).toBe('failed')
    expect(result.trial?.error).toContain('exploded')
    expect(fakes.threadService.delete).toHaveBeenCalledWith('thr-test')
  })

  it('trial aborts the turn when the timeout elapses', async () => {
    const fakes = trialFakes({ turnStatus: 'aborted' })
    const definition = acpDefinition('basic-chat.json')
    const runtime = runtimeWith(definition, {
      runTurn: () => new Promise(() => {})
    } as unknown as ServerRuntime, fakes)
    const result = await runHarnessTest(runtime, definition, {
      level: 'trial',
      timeoutMs: 150
    })
    expect(result.ok).toBe(false)
    expect(result.trial?.status).toBe('aborted')
    expect(fakes.turnService.interruptTurn).toHaveBeenCalledWith({
      threadId: 'thr-test',
      turnId: 'turn-1'
    })
    expect(fakes.threadService.delete).toHaveBeenCalledWith('thr-test')
  })

  it('cancels an active trial when its HTTP request aborts', async () => {
    const fakes = trialFakes({ turnStatus: 'aborted' })
    const definition = cliDefinition()
    const controller = new AbortController()
    const runtime = runtimeWith(definition, {
      runTurn: () => new Promise(() => undefined)
    } as unknown as ServerRuntime, fakes)
    const trial = runHarnessTest(runtime, definition, { level: 'trial', timeoutMs: 120_000 }, controller.signal)
    await vi.waitFor(() => expect(fakes.turnService.startTurn).toHaveBeenCalled())
    controller.abort()
    const result = await trial
    expect(result.trial?.status).toBe('aborted')
    expect(fakes.turnService.interruptTurn).toHaveBeenCalledWith({ threadId: 'thr-test', turnId: 'turn-1' })
    expect(fakes.threadService.delete).toHaveBeenCalledWith('thr-test')
  })

  it('skips the trial when a real handshake failed', async () => {
    const fakes = trialFakes()
    const definition = acpDefinition('does-not-exist.json')
    const runtime = runtimeWith(definition, {
      runTurn: async () => 'completed'
    } as unknown as ServerRuntime, fakes)
    const result = await runHarnessTest(runtime, definition, { level: 'trial' })
    expect(result.ok).toBe(false)
    expect(result.handshake?.ok).toBe(false)
    expect(result.trial).toBeUndefined()
    expect(fakes.threadService.create).not.toHaveBeenCalled()
  })

  it('still runs the trial for transports without a handshake surface', async () => {
    const fakes = trialFakes({ turnStatus: 'completed' })
    const definition = cliDefinition()
    const runtime = runtimeWith(definition, {
      runTurn: async () => 'completed'
    } as unknown as ServerRuntime, fakes)
    const result = await runHarnessTest(runtime, definition, { level: 'trial' })
    expect(result.handshake?.supported).toBe(false)
    expect(result.trial?.ok).toBe(true)
  })
})
