import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

describe('DelegationRuntime dynamic detach status', () => {
  it('returns a live detached record while the same child continues to terminal settlement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-detach-status-'))
    try {
      let childId = ''
      let executorFinished = false
      let releaseExecutor = (): void => undefined
      const executorGate = new Promise<void>((resolve) => {
        releaseExecutor = resolve
      })
      const store = new FileDelegationStore(dir)
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store,
        executor: async () => {
          await executorGate
          executorFinished = true
          return { summary: 'background child completed' }
        }
      })

      const running = runtime.runChild({
        parentThreadId: 'thread_parent',
        parentTurnId: 'turn_parent',
        launcher: 'delegate_task',
        prompt: 'continue in background',
        signal: new AbortController().signal,
        onStart: (id) => { childId = id }
      })

      await waitFor(() => childId.length > 0)
      await waitForAsync(async () => (await store.get(childId))?.status === 'running')
      expect(await runtime.detachChild(childId)).toBe(true)

      const detached = await running
      expect(detached).toMatchObject({
        id: childId, status: 'running', detached: true
      })
      expect(executorFinished).toBe(false)
      await expect(store.get(childId)).resolves.toMatchObject({
        status: 'running', detached: true
      })

      releaseExecutor()
      await waitForAsync(async () => (await store.get(childId))?.status === 'completed')
      expect(executorFinished).toBe(true)
      await expect(store.get(childId)).resolves.toMatchObject({
        status: 'completed', detached: true, summary: 'background child completed'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function subagentConfig() {
  return SubagentsCapabilityConfig.parse({
    enabled: true,
    maxParallel: 1
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (true) {
    try {
      if (await predicate()) return
    } catch {
      // FileDelegationStore uses plain writes in tests; retry an in-flight read.
    }
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for async condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
