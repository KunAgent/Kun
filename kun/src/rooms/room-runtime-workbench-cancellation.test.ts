import { afterEach, expect, it, vi } from 'vitest'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { confirmWorkbenchLink, requestWorkbenchCancel } from '../workbench-bridge/actions.js'
import { reconcileWorkbench } from '../workbench-bridge/reconcile.js'
import { workbenchFixture } from '../workbench-bridge/workbench-test-support.js'
import { RoomRuntime } from './room-runtime.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it('serializes a bridge admission with cancellation so no admitted turn escapes Stop', async () => {
  const f = await workbenchFixture(); cleanups.push(f.cleanup)
  const runtime = new RoomRuntime({ ...f.deps, assertOwnership: async () => {}, runTurn: async () => {} })
  cleanups.push(() => runtime.close())
  const project = await f.makeDirectory('project'); f.addCodeThread('existing', project)
  const created = (await f.run('create_code_task', { title: 'Bound task', goal: 'Run the check', projectRoot: project }, 'task-call')).output as { linkId: string }
  const original = (await f.store.get<WorkbenchLink>('workbench_link', created.linkId))!
  await confirmWorkbenchLink(runtime.workbench, f.room.id, created.linkId, { clientRequestId: 'confirm', expectedRevision: original.revision })
  await reconcileWorkbench(runtime.workbench)
  const link = (await f.store.get<WorkbenchLink>('workbench_link', created.linkId))!.value
  expect(link.threadId).toBeTruthy(); expect(f.stub.calls.enqueued).toHaveLength(0)
  let entered!: () => void, release!: () => void
  const reached = new Promise<void>((resolve) => { entered = resolve })
  const barrier = new Promise<void>((resolve) => { release = resolve })
  const realResolve = runtime.workbench.resolveDirectory.bind(runtime.workbench)
  vi.spyOn(runtime.workbench, 'resolveDirectory').mockImplementation(async (path) => {
    entered(); await barrier; return realResolve(path)
  })
  const driver = runtime as unknown as { stopped: boolean; tick(): Promise<void> }
  driver.stopped = false
  const tick = driver.tick()
  await reached
  let cancelled = false
  const stop = runtime.exclusive(async () => {
    const result = await requestWorkbenchCancel(runtime.workbench, f.room.id, created.linkId)
    cancelled = true; return result
  })
  await new Promise((resolve) => setImmediate(resolve))
  const overlapped = cancelled
  release()
  await tick; await stop
  driver.stopped = true
  expect(overlapped).toBe(false)
  expect(f.stub.calls.enqueued).toHaveLength(1)
  const thread = f.stub.threads.get(link.threadId!)!
  expect(thread.turns).toHaveLength(1)
  expect(thread.turns[0].status).toBe('aborted')
  expect((await f.store.get<WorkbenchLink>('workbench_link', created.linkId))!.value.cancelRequested).toBe(true)
})
