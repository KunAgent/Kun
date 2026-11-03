import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { DetachedChildHandoffCoordinator } from './delegation-detached-handoff.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

function deferred() {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('DelegationRuntime settled child cancellation', () => {
  it.each([false, true])('stops cancellation before notification, preserving deletion waits (dynamic=%s)', async (dynamic) => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-settled-cancellation-'))
    const started = deferred()
    const release = deferred()
    const notifying = deferred()
    const delivered = deferred()
    const handoff = vi.spyOn(DetachedChildHandoffCoordinator.prototype, 'deliverRecord')
      .mockImplementation(async () => {
        notifying.resolve()
        await delivered.promise
      })
    let childSignal: AbortSignal | undefined
    let deletion: Promise<number> | undefined
    try {
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 1 }),
        store: new FileDelegationStore(dir),
        idGenerator: () => 'child_settled',
        executor: async ({ signal }) => {
          childSignal = signal
          started.resolve()
          await release.promise
          return { summary: 'done' }
        }
      })
      const run = runtime.runChild({
        parentThreadId: 'parent', parentTurnId: 'turn', prompt: 'work',
        detach: !dynamic, signal: new AbortController().signal
      })
      await started.promise
      if (dynamic) expect(await runtime.detachChild('child_settled')).toBe(true)
      await run
      release.resolve()
      await notifying.promise
      const diagnostics = await runtime.diagnostics('parent')
      expect(diagnostics.active).toBe(0)
      expect(diagnostics.childRuns[0]?.status).toBe('completed')
      expect(runtime.abortChild('child_settled')).toBe(false)
      expect(childSignal?.aborted).toBe(false)

      let deletionFinished = false
      deletion = runtime.abortDetachedChildrenForThread('parent')
        .then((count) => { deletionFinished = true; return count })
      // A microtask checkpoint, not a timing-based sleep: deletion must still
      // await the gated handoff even though there is no execution to abort.
      await Promise.resolve()
      await Promise.resolve()
      expect(deletionFinished).toBe(false)
      expect(childSignal?.aborted).toBe(false)
      delivered.resolve()
      await expect(deletion).resolves.toBe(0)
    } finally {
      release.resolve()
      delivered.resolve()
      await deletion
      handoff.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
