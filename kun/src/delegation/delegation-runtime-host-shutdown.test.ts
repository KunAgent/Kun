import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KunCapabilitiesConfig } from '../contracts/capabilities.js'
import { hostShutdownTurnSuspensionReason } from '../services/turn-service.js'
import { deferred, waitFor } from '../../tests/support/delegation-runtime-fixtures.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

describe('DelegationRuntime host shutdown classification', () => {
  it('records a host-suspended generic child as resumable runtime_restart work', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-child-host-shutdown-'))
    try {
      const executionStarted = deferred<void>()
      const runtime = new DelegationRuntime({
        config: KunCapabilitiesConfig.parse({
          subagents: {
            enabled: true,
            useExistingAgents: true,
            maxParallel: 4,
            profiles: { general: { toolPolicy: 'inherit' } }
          }
        }).subagents,
        store: new FileDelegationStore(directory),
        idGenerator: () => 'child_host_shutdown',
        executor: async ({ signal }) => {
          executionStarted.resolve()
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => resolve(), { once: true })
          })
          throw new Error('host suspended child execution')
        }
      })
      const parent = new AbortController()
      const run = runtime.runChild({
        parentThreadId: 'parent_thread',
        parentTurnId: 'parent_turn',
        prompt: 'inspect the repository',
        launcher: 'fast_context',
        profile: 'general',
        workspace: '/workspace',
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        signal: parent.signal
      })
      await executionStarted.promise
      await waitFor(async () => (await runtime.diagnostics()).active === 1)

      parent.abort(hostShutdownTurnSuspensionReason())

      await expect(run).resolves.toMatchObject({
        status: 'failed',
        terminationReason: 'runtime_restart',
        resumable: true
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
