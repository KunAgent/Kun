import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { probeAcpReadiness } from './acp-readiness-probe.js'
import type { AcpSpawnFn } from '../runtime/acp/acp-process.js'
import { ACP_DEFAULT_CAPABILITIES } from './builtin-harnesses.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'

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

function def(scenario: string, args: string[] = [FIXTURE_AGENT]): HarnessDefinition {
  return {
    id: 'fake-acp' as HarnessId,
    displayName: 'Fake ACP',
    transport: 'acp',
    launch: {
      command: process.execPath,
      args,
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

describe('probeAcpReadiness', () => {
  it('reports ready on a successful initialize handshake', async () => {
    const result = await probeAcpReadiness(
      def('basic-chat.json'),
      process.execPath,
      { spawn: spawnAgent }
    )
    expect(result).toEqual({ ready: 'yes' })
  })

  it('reports not-ready when the agent exits during the handshake', async () => {
    const result = await probeAcpReadiness(
      def('does-not-exist.json'),
      process.execPath,
      { spawn: spawnAgent }
    )
    expect(result.ready).toBe('no')
    expect(result.detail).toBeTruthy()
  })

  it('reports unknown (not failed) when initialize does not answer in time', async () => {
    // P4-03: a timeout means "no answer yet" — a slow cold start is not a
    // definitive unready verdict, so the UI can offer a retry.
    const silent = def('basic-chat.json', ['-e', 'setInterval(() => {}, 1_000)'])
    const result = await probeAcpReadiness(silent, process.execPath, {
      spawn: spawnAgent,
      timeoutMs: 300
    })
    expect(result.ready).toBe('unknown')
    expect(result.detail).toContain('timed out')
  })

  it('reports not-ready when the agent speaks an unsupported protocol', async () => {
    const result = await probeAcpReadiness(
      def('unsupported-version.json'),
      process.execPath,
      { spawn: spawnAgent }
    )
    expect(result.ready).toBe('no')
    expect(result.detail).toContain('protocol_version_unsupported')
  })

  it('reports not-ready when spawn itself fails', async () => {
    const result = await probeAcpReadiness(def('basic-chat.json'), '/nonexistent/acp-agent', {
      spawn: async () => {
        throw new Error('ENOENT')
      }
    })
    expect(result).toMatchObject({ ready: 'no' })
    expect(result.detail).toContain('ENOENT')
  })
})
