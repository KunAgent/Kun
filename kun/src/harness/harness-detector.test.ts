import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HarnessDetector } from './harness-detector.js'
import { ACP_DEFAULT_CAPABILITIES } from './builtin-harnesses.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import type { HarnessLoginState } from './harness-login-probes.js'

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
  overrides?: Record<string, { binaryPath?: string }>
  resolve?: (command: string) => Promise<string | undefined>
  spawnCaptured?: (
    command: string,
    args: readonly string[],
    options: { timeoutMs: number }
  ) => Promise<{ stdout: string; stderr: string; timedOut: boolean; exitCode: number | null }>
  probeReady?: (
    def: HarnessDefinition,
    command: string
  ) => Promise<{ ready: 'yes' | 'no' | 'unknown'; detail?: string }>
  readinessCache?: {
    get(id: HarnessId, command: string, version: string | undefined): Promise<'yes' | undefined>
    set(id: HarnessId, command: string, version: string | undefined): Promise<void>
    clear(id: HarnessId): Promise<void>
  }
  login?: HarnessLoginState
}) {
  return new HarnessDetector({
    definitions: () => input.defs,
    overrides: () => input.overrides ?? {},
    spawnCaptured: input.spawnCaptured ?? (async () => ({
      stdout: 'opencode 1.1.47\n',
      stderr: '',
      timedOut: false,
      exitCode: 0
    })),
    resolveExecutable:
      input.resolve ?? (async (command) => `/usr/bin/${command}`),
    probeReady: input.probeReady,
    ...(input.readinessCache ? { readinessCache: input.readinessCache } : {}),
    probeLogin: async () => input.login ?? 'unknown',
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
    expect(status.reasonCode).toBe('handshake_failed')
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
    expect(status.reasonCode).toBe('adapter_missing')
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
    expect(status.reasonCode).toBe('not_installed')
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
    expect(status.reasonCode).toBe('handshake_timeout')
    expect(status.message).toContain('inconclusive')
  })

  it('does not reuse persisted command/version-only readiness', async () => {
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
    expect(calls).toEqual(['probe'])
    expect(stored).toEqual([])
  })

  it('does not persist successful metadata as authoritative readiness', async () => {
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
    expect(stored).toEqual([])
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
    expect(after?.reasonCode).toBe('handshake_failed')
    expect(after?.message).toContain('harness exited during initialize')
    await vi.waitFor(() => expect(cleared).toEqual(['opencode']))
  })

  it('reports version_too_low when the probed version is below minVersion', async () => {
    const def = acpDef({
      detect: {
        command: 'opencode',
        aliases: [],
        versionArgs: ['--version'],
        minVersion: '9.9.9'
      }
    })
    const detector = makeDetector({
      defs: [def],
      probeReady: async () => ({ ready: 'yes' })
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status.versionSupported).toBe(false)
    expect(status.reasonCode).toBe('version_too_low')
  })

  it('reports signed_out only after install and handshake pass', async () => {
    const detector = makeDetector({
      defs: [acpDef()],
      login: 'signed-out',
      probeReady: async () => ({ ready: 'yes' })
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status.ready).toBe('yes')
    expect(status.reasonCode).toBe('signed_out')
  })

  it('leaves reasonCode unset when the harness is usable', async () => {
    const detector = makeDetector({
      defs: [acpDef()],
      probeReady: async () => ({ ready: 'yes' })
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status.reasonCode).toBeUndefined()
  })

  it('probes native Codex after finding its CLI, without an ACP adapter', async () => {
    const codex = acpDef({
      id: 'codex',
      transport: 'codex-app-server',
      detect: { command: 'codex', aliases: [], versionArgs: ['--version'] },
      launch: { command: 'codex', args: ['app-server'], env: {} }
    })
    const probeReady = vi.fn(async () => ({ ready: 'yes' as const }))
    const detector = makeDetector({
      defs: [codex],
      resolve: async (command) => command === 'codex' ? '/usr/bin/codex' : undefined,
      probeReady
    })
    const status = await detector.status('codex', { force: true })
    expect(status).toMatchObject({ installed: 'yes', ready: 'yes', resolvedCommand: '/usr/bin/codex' })
    expect(probeReady).toHaveBeenCalledWith(codex, '/usr/bin/codex', { signal: expect.any(AbortSignal) })
  })

  it('discards a late probe from an older launch definition', async () => {
    const oldDef = acpDef({ launch: { command: 'opencode', args: ['acp'], env: {} } })
    let definition = oldDef
    let resolveOld: ((value: { ready: 'yes' }) => void) | undefined
    const detector = new HarnessDetector({
      definitions: () => [definition],
      overrides: () => ({}),
      spawnCaptured: async () => ({ stdout: '1.1.47', stderr: '', timedOut: false, exitCode: 0 }),
      resolveExecutable: async (command) => `/usr/bin/${command}`,
      probeReady: async (def) => def.launch?.args[0] === 'acp'
        ? new Promise((resolve) => { resolveOld = resolve })
        : { ready: 'no', detail: 'new configuration failed' },
      probeLogin: async () => 'unknown',
      nowMs: () => Date.now(),
      nowIso: () => new Date().toISOString()
    })
    const oldProbe = detector.status('opencode')
    await vi.waitFor(() => expect(resolveOld).toBeDefined())
    definition = acpDef({ launch: { command: 'opencode', args: ['acp-new'], env: {} } })
    const newStatus = await detector.status('opencode')
    expect(newStatus.ready).toBe('no')
    resolveOld!({ ready: 'yes' })
    await oldProbe
    expect(detector.cachedStatus('opencode')?.ready).toBe('no')
  })

  it('P4-13: terminal agents skip the version probe entirely', async () => {
    // Interactive CLIs often ignore `--version` and wait on stdin — running
    // it would hang the 5s timeout and mask an installed agent.
    const spawned: string[] = []
    const detector = makeDetector({
      defs: [acpDef({ transport: 'terminal' })],
      spawnCaptured: async (command) => {
        spawned.push(command)
        return { stdout: '', stderr: '', timedOut: true, exitCode: null }
      }
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status).toMatchObject({
      installed: 'yes',
      login: 'unknown',
      resolvedCommand: '/usr/bin/opencode'
    })
    expect(status.version).toBeUndefined()
    expect(status.reasonCode).toBeUndefined()
    expect(spawned).toEqual([])
  })

  it('P4-13: a terminal agent whose command is missing stays not_installed', async () => {
    const detector = makeDetector({
      defs: [acpDef({ transport: 'terminal' })],
      resolve: async () => undefined
    })
    const status = await detector.status('opencode' as HarnessId, { force: true })
    expect(status.installed).toBe('no')
    expect(status.reasonCode).toBe('not_installed')
  })
})


describe('safe current detection evidence', () => {
  it.each([1, null])('does not accept a version printed by an unsuccessful process (%s)', async (exitCode) => {
    const probeReady = vi.fn(async () => ({ ready: 'yes' as const }))
    const detector = makeDetector({ defs: [acpDef()], probeReady,
      spawnCaptured: async () => ({ stdout: 'opencode 1.1.47', stderr: 'failed', timedOut: false, exitCode }) })
    expect(await detector.status('opencode')).toMatchObject({ installed: 'unknown' })
    expect(probeReady).not.toHaveBeenCalled()
  })

  it('fails a broken explicit binary path without falling back to PATH', async () => {
    const resolve = vi.fn(async (command: string) => command === '/broken' ? undefined : `/bin/${command}`)
    const detector = makeDetector({ defs: [acpDef()], overrides: { opencode: { binaryPath: '/broken' } }, resolve })
    expect(await detector.status('opencode')).toMatchObject({ installed: 'no', message: 'command not found: /broken' })
    expect(resolve).toHaveBeenCalledExactlyOnceWith('/broken')
  })

  it.each([
    ['0.2.0-rc.1', false], ['0.2.0-rc.2', true], ['0.2.0-rc.2+custom', false],
    ['0.2.0-rc.3', false], ['0.2.0', false], ['0.3.0', false]
  ])('enforces exact prerelease version %s', async (version, supported) => {
    const probeReady = vi.fn(async () => ({ ready: 'yes' as const }))
    const detector = makeDetector({ defs: [acpDef({ detect: {
      command: 'fixture', aliases: [], versionArgs: ['--version'], exactVersion: '0.2.0-rc.2'
    } })], probeReady,
    spawnCaptured: async () => ({ stdout: `fixture ${version}`, stderr: '', timedOut: false, exitCode: 0 }) })
    expect(await detector.status('opencode')).toMatchObject({ version, versionSupported: supported })
    expect(probeReady).toHaveBeenCalledTimes(supported ? 1 : 0)
  })

  it('freshly probes repeated status requests even when version and definition are unchanged', async () => {
    const probeReady = vi.fn().mockResolvedValueOnce({ ready: 'yes' }).mockResolvedValueOnce({ ready: 'no' })
    const detector = makeDetector({ defs: [acpDef()], probeReady })
    expect((await detector.status('opencode')).ready).toBe('yes')
    expect((await detector.status('opencode')).ready).toBe('no')
    expect(probeReady).toHaveBeenCalledTimes(2)
  })

  it('invalidates display snapshots when a binary is replaced without changing its path/version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'detector-binary-'))
    const binary = join(home, 'opencode')
    try {
      await writeFile(binary, 'version-one')
      const detector = makeDetector({ defs: [acpDef()], resolve: async () => binary })
      await detector.status('opencode')
      expect(detector.cachedStatus('opencode')?.installed).toBe('yes')
      await writeFile(binary, 'version-two-with-different-content')
      expect(detector.cachedStatus('opencode')).toBeUndefined()
    } finally { await rm(home, { recursive: true, force: true }) }
  })

  it('never reuses a snapshot with opaque secret references', async () => {
    const detector = makeDetector({ defs: [acpDef({ launch: { command: 'opencode', args: ['acp'], env: {},
      secretEnv: [{ name: 'API_KEY', secretRef: 'rotating-ref' }] } })] })
    await detector.status('opencode')
    expect(detector.cachedStatus('opencode')).toBeUndefined()
  })

  it('honors pre-aborted detection without resolving or spawning', async () => {
    const resolve = vi.fn(async () => '/fixture')
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const detector = makeDetector({ defs: [acpDef()], resolve })
    await expect(detector.status('opencode', { signal: controller.signal })).rejects.toThrow('cancelled')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('bounds a stalled resolver and prevents late version probes', async () => {
    let finish!: (value: string) => void
    const spawnCaptured = vi.fn(async () => ({ stdout: '1.0.0', stderr: '', timedOut: false, exitCode: 0 }))
    const detector = makeDetector({ defs: [acpDef()], spawnCaptured,
      resolve: () => new Promise((resolve) => { finish = resolve }) })
    await expect(detector.status('opencode', { timeoutMs: 20 })).rejects.toThrow()
    finish('/late/fixture')
    await Promise.resolve()
    expect(spawnCaptured).not.toHaveBeenCalled()
    expect(detector.cachedStatus('opencode')).toBeUndefined()
  })

  it('does not publish a success after cancellation during readiness', async () => {
    let finish!: (value: { ready: 'yes' }) => void
    const controller = new AbortController()
    const probeReady = vi.fn(() => new Promise<{ ready: 'yes' }>((resolve) => { finish = resolve }))
    const detector = makeDetector({ defs: [acpDef()], probeReady })
    const pending = detector.status('opencode', { signal: controller.signal })
    await vi.waitFor(() => expect(probeReady).toHaveBeenCalled())
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    finish({ ready: 'yes' })
    await Promise.resolve()
    expect(detector.cachedStatus('opencode')).toBeUndefined()
  })
})
