import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { ChildRunRecord, DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

const SECURITY = { sandboxRoot: '/workspace', memoryEnabled: false }

describe('DelegationRuntime orphan sweep ownership', () => {
  it('fails only previous-process children, never children this process queued or started', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-orphan-owned-'))
    try {
      const store = new FileDelegationStore(dir)
      await store.upsert(ChildRunRecord.parse({
        id: 'child_previous_process',
        parentThreadId: 'parent',
        parentTurnId: 'turn-0',
        prompt: 'old work',
        status: 'running',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z'
      }))
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 1 }),
        store,
        executor: async () => {
          await gate
          return { summary: 'done' }
        }
      })
      const run = (childId: string) => runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        childId,
        launcher: 'manager-worker',
        prompt: `task ${childId}`,
        workspace: '/workspace',
        security: SECURITY,
        signal: new AbortController().signal
      })
      // Foreground children are never registered as detached runs.
      const running = run('child_running')
      await vi.waitFor(async () => {
        expect((await store.get('child_running'))?.status).toBe('running')
      })
      const waiting = run('child_waiting_for_slot')
      await vi.waitFor(async () => {
        expect((await store.get('child_waiting_for_slot'))?.status).toBe('queued')
      })

      await expect(runtime.reconcileOrphanedChildRuns()).resolves.toBe(1)

      expect((await store.get('child_previous_process'))?.terminationReason).toBe('runtime_restart')
      expect((await store.get('child_running'))?.status).toBe('running')
      expect((await store.get('child_waiting_for_slot'))?.status).toBe('queued')
      release()
      await expect(running).resolves.toMatchObject({ status: 'completed' })
      await expect(waiting).resolves.toMatchObject({ status: 'completed' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
