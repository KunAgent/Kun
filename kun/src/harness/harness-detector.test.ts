import { describe, expect, it } from 'vitest'
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
  ) => Promise<{ ready: 'yes' | 'no'; detail?: string }>
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
})
