import { describe, expect, it, vi } from 'vitest'
import { HarnessDetector } from './harness-detector.js'
import { ACP_DEFAULT_CAPABILITIES } from './builtin-harnesses.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'

function acpDef(overrides: Partial<HarnessDefinition> = {}): HarnessDefinition {
  return {
    id: 'opencode' as HarnessId,
    displayName: 'OpenCode',
    transport: 'acp',
    detect: {
      command: 'opencode',
      aliases: [],
      versionArgs: ['--version']
    },
    launch: { command: 'opencode', args: ['acp'], env: {} },
    credentialModes: ['native-login'],
    permissionModes: [
      { id: 'default', label: 'Default', kunPermissionMode: 'ask-for-approval' }
    ],
    modelSource: 'static',
    staticModels: [],
    capabilities: ACP_DEFAULT_CAPABILITIES,
    builtin: true,
    ...overrides
  }
}

function makeDetector(input: {
  defs: HarnessDefinition[]
  resolve?: (command: string) => Promise<string | undefined>
  probeReady?: (
    def: HarnessDefinition,
    command: string
  ) => Promise<{ ready: 'yes' | 'no' | 'unknown'; detail?: string }>
  readinessCache?: {
    get(id: HarnessId, command: string, version: string | undefined): Promise<'yes' | undefined>
    set(id: HarnessId, command: string, version: string | undefined): Promise<void>
    clear(id: HarnessId): Promise<void>
  }
}) {
  return new HarnessDetector({
    definitions: () => input.defs,
    overrides: () => ({}),
    spawnCaptured: async () => ({
      stdout: 'opencode 1.1.47\n',
      stderr: '',
      timedOut: false,
      exitCode: 0
    }),
    resolveExecutable:
      input.resolve ?? (async (command) => `/usr/bin/${command}`),
    probeReady: input.probeReady,
    ...(input.readinessCache ? { readinessCache: input.readinessCache } : {}),
    probeLogin: async () => 'unknown',
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString()
  })
}

describe('HarnessDetector readiness (P3-11)', () => {
  it('marks an ACP harness ready when initialize succeeds', async () => {
    const detector = makeDetector({
      defs: [acpDef()],
      probeReady: async () => ({ ready: 'yes' })
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status).toMatchObject({ installed: 'yes', ready: 'yes' })
  })

  it('marks installed-but-not-ready with the handshake stderr summary', async () => {
    const detector = makeDetector({
      defs: [acpDef()],
      probeReady: async () => ({ ready: 'no', detail: 'agent_error: boom' })
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status.installed).toBe('yes')
    expect(status.ready).toBe('no')
    expect(status.message).toContain('ACP initialize failed')
    expect(status.message).toContain('boom')
  })

  it('shows adapter install guidance when the fallback binary exists', async () => {
    const codex = acpDef({
      id: 'codex' as HarnessId,
      detect: {
        command: 'codex-acp',
        aliases: [],
        versionArgs: ['--version'],
        adapterHint: {
          command: 'codex',
          message: 'install codex-acp to enable ACP'
        }
      },
      launch: { command: 'codex-acp', args: [], env: {} }
    })
    const detector = makeDetector({
      defs: [codex],
      resolve: async (command) =>
        command === 'codex' ? '/usr/bin/codex' : undefined
    })
    const status = await detector.status('codex' as HarnessId, { force: true })
    expect(status.installed).toBe('no')
    expect(status.message).toBe('install codex-acp to enable ACP')
  })

  it('keeps the plain not-found message when the fallback is absent too', async () => {
    const codex = acpDef({
      id: 'codex' as HarnessId,
      detect: {
        command: 'codex-acp',
        aliases: [],
        versionArgs: ['--version'],
        adapterHint: {
          command: 'codex',
          message: 'install codex-acp to enable ACP'
        }
      },
      launch: { command: 'codex-acp', args: [], env: {} }
    })
    const detector = makeDetector({
      defs: [codex],
      resolve: async () => undefined
    })
    const status = await detector.status('codex' as HarnessId, { force: true })
    expect(status.installed).toBe('no')
    expect(status.message).toBe('command not found: codex-acp')
  })

  it('reports a probe timeout as inconclusive, not a failure (P4-03)', async () => {
    const detector = makeDetector({
      defs: [acpDef()],
      probeReady: async () => ({ ready: 'unknown', detail: 'probe timed out after 30000ms' })
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status.installed).toBe('yes')
    expect(status.ready).toBe('unknown')
    expect(status.message).toContain('inconclusive')
  })

  it('skips the probe on a fresh readiness-cache hit and records successes', async () => {
    const calls: string[] = []
    const stored: Array<{ id: string; command: string; version?: string }> = []
    const detector = makeDetector({
      defs: [acpDef()],
      readinessCache: {
        get: async (id, command, version) => {
          calls.push(`get:${command}@${version}`)
          return 'yes'
        },
        set: async (id, command, version) => {
          stored.push({ id, command, version })
        },
        clear: async () => undefined
      },
      probeReady: async () => {
        calls.push('probe')
        return { ready: 'yes' }
      }
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status.ready).toBe('yes')
    expect(calls).toEqual(['get:/usr/bin/opencode@1.1.47'])
    expect(stored).toEqual([])
  })

  it('writes a successful probe into the readiness cache', async () => {
    const stored: Array<{ id: string; command: string; version?: string }> = []
    const detector = makeDetector({
      defs: [acpDef()],
      readinessCache: {
        get: async () => undefined,
        set: async (id, command, version) => {
          stored.push({ id, command, version })
        },
        clear: async () => undefined
      },
      probeReady: async () => ({ ready: 'yes' })
    })
    await detector.status('opencode' as HarnessId, { force: true })
    expect(stored).toEqual([
      { id: 'opencode', command: '/usr/bin/opencode', version: '1.1.47' }
    ])
  })

  it('does not cache a failed or inconclusive probe', async () => {
    const stored: string[] = []
    for (const ready of ['no', 'unknown'] as const) {
      const detector = makeDetector({
        defs: [acpDef()],
        readinessCache: {
          get: async () => undefined,
          set: async (id) => {
            stored.push(`${ready}:${id}`)
          },
          clear: async () => undefined
        },
        probeReady: async () => ({ ready })
      })
      await detector.status('opencode' as HarnessId, { force: true })
    }
    expect(stored).toEqual([])
  })

  it('recordLaunchFailure marks the cached status not-ready and clears the cache', async () => {
    const cleared: string[] = []
    const detector = makeDetector({
      defs: [acpDef()],
      readinessCache: {
        get: async () => 'yes',
        set: async () => undefined,
        clear: async (id) => {
          cleared.push(id)
        }
      },
      probeReady: async () => ({ ready: 'yes' })
    })
    const ready = await detector.status('opencode' as HarnessId, { force: true })
    expect(ready.ready).toBe('yes')

    detector.recordLaunchFailure('opencode' as HarnessId, 'harness exited during initialize')
    const after = detector.cachedStatus('opencode' as HarnessId)
    expect(after?.ready).toBe('no')
    expect(after?.message).toContain('harness exited during initialize')
    await vi.waitFor(() => expect(cleared).toEqual(['opencode']))
  })
})
