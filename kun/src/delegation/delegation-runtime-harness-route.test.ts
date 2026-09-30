import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

// ADE worker dispatch pins a frozen harness route resolved by
// `resolveWorkerRoute`. `native-login` and provider-fallback routes carry a
// harness-native model with no Kun providerId, so a pinned harness must not
// hit the model-authored delegate_task pair rule.
describe('DelegationRuntime pinned harness routes', () => {
  it('accepts a model-only explicit route when the host pins a harness', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-harness-route-'))
    try {
      const seen: Array<{ model?: string; providerId?: string; harnessId?: string }> = []
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 1 }),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          seen.push({
            model: input.model,
            providerId: input.providerId,
            harnessId: input.harnessId
          })
          return { summary: 'done' }
        }
      })

      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'native-login worker task',
        harnessId: 'claude-code',
        credentialMode: 'native-login',
        model: 'claude-sonnet-5',
        signal: new AbortController().signal
      })

      expect(record.status).toBe('completed')
      expect(seen).toEqual([{
        model: 'claude-sonnet-5',
        providerId: undefined,
        harnessId: 'claude-code'
      }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
