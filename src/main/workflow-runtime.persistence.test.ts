import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, normalizeWorkflow, type AppSettingsV1, type WorkflowV1 } from '../shared/app-settings'
import { createWorkflowRuntime, type WorkflowRuntime } from './workflow-runtime'
import { deferred } from './workflow-test-deferred'

const runtimes: WorkflowRuntime[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()))
})

function createFixture() {
  const workflow = normalizeWorkflow({
    id: 'workflow', name: 'Workflow', enabled: true,
    nodes: [
      { id: 'trigger', type: 'manual-trigger', config: {} },
      { id: 'delay', type: 'delay', config: { delayMs: 0 } }
    ],
    connections: [{ id: 'edge', source: 'trigger', target: 'delay' }]
  } as unknown as Partial<WorkflowV1>, 0, '2026-10-05T00:00:00.000Z')
  let current = normalizeAppSettings({ workflow: { enabled: true, workflows: [workflow] } } as AppSettingsV1)
  const store = {
    load: vi.fn(async () => current),
    update: vi.fn(async (mutation: (settings: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>) => {
      current = await mutation(current)
      return current
    })
  }
  const logError = vi.fn()
  const runtime = createWorkflowRuntime({ store: store as never, logError, runtimeRequest: vi.fn() })
  runtimes.push(runtime)
  return { runtime, store, logError, settings: () => current }
}

describe('WorkflowRuntime persistence ownership', () => {
  it('releases ownership when the initial write fails and allows a retry', async () => {
    const { runtime, store, logError, settings } = createFixture()
    store.update.mockRejectedValueOnce(new Error('start disk failure'))
    const result = await runtime.runWorkflowByRef('workflow').catch((error) => ({ error }))

    expect((await runtime.status()).runningWorkflowIds).toEqual([])
    expect(result).toMatchObject({ ok: false, status: 'error', message: expect.stringContaining('start disk failure') })
    expect(logError).toHaveBeenCalledWith('workflow-persistence', expect.any(String), expect.objectContaining({
      workflowId: 'workflow', phase: 'start', message: 'start disk failure'
    }))
    expect(settings().workflow.workflows[0].runs).toEqual([])
    expect(await runtime.stopWorkflow('workflow')).toMatchObject({ ok: false })
    expect(await runtime.runWorkflowByRef('workflow')).toMatchObject({ ok: true, status: 'success' })
  })

  it('releases ownership when the final write fails and allows a retry', async () => {
    const { runtime, store, logError } = createFixture()
    const update = store.update.getMockImplementation()!
    store.update.mockImplementationOnce(update).mockRejectedValueOnce(new Error('finish disk failure'))
    const result = await runtime.runWorkflowByRef('workflow').catch((error) => ({ error }))

    expect((await runtime.status()).runningWorkflowIds).toEqual([])
    expect(result).toMatchObject({ ok: false, status: 'error', message: expect.stringContaining('finish disk failure') })
    expect(logError).toHaveBeenCalledWith('workflow-persistence', expect.any(String), expect.objectContaining({
      workflowId: 'workflow', phase: 'finish', message: 'finish disk failure'
    }))
    expect(await runtime.stopWorkflow('workflow')).toMatchObject({ ok: false })
    expect(await runtime.runWorkflowByRef('workflow')).toMatchObject({ ok: true, status: 'success' })
  })

  it('keeps cancellation visible and releases ownership if saving the canceled run fails', async () => {
    const { runtime, store, logError, settings } = createFixture()
    const delay = settings().workflow.workflows[0].nodes.find((node) => node.type === 'delay')!
    if (delay.type === 'delay') delay.config.delayMs = 60_000
    const update = store.update.getMockImplementation()!
    store.update.mockImplementationOnce(update).mockRejectedValueOnce(new Error('cancel disk failure'))
    const task = runtime.runWorkflowByRef('workflow').catch((error) => ({ error }))
    await vi.waitFor(async () => expect((await runtime.status()).nodeStatus.workflow.delay).toBe('running'))

    expect(await runtime.stopWorkflow('workflow')).toMatchObject({ ok: true })
    const result = await task
    expect((await runtime.status()).runningWorkflowIds).toEqual([])
    expect(result).toMatchObject({ ok: false, status: 'error', message: expect.stringMatching(/Canceled.*cancel disk failure/s) })
    expect(logError).toHaveBeenCalledWith('workflow-persistence', expect.any(String), expect.objectContaining({ phase: 'finish' }))
    if (delay.type === 'delay') delay.config.delayMs = 0
    expect(await runtime.runWorkflowByRef('workflow')).toMatchObject({ ok: true, status: 'success' })
  })

  it('keeps per-workflow deduplication while a persistence write is pending', async () => {
    const { runtime, store } = createFixture()
    const update = store.update.getMockImplementation()!
    const gate = deferred()
    store.update.mockImplementationOnce(async (mutation) => {
      await gate.promise
      return update(mutation)
    })
    const task = runtime.runWorkflowByRef('workflow')
    await vi.waitFor(async () => expect((await runtime.status()).runningWorkflowIds).toEqual(['workflow']))
    try {
      expect(await runtime.runWorkflowByRef('workflow')).toMatchObject({ ok: false, message: 'Workflow is already running.' })
    } finally {
      gate.resolve()
    }
    expect(await task).toMatchObject({ ok: true, status: 'success' })
  })

  it('releases ownership even if reporting a failed persistence write also throws', async () => {
    const { runtime, store, logError } = createFixture()
    store.update.mockRejectedValueOnce(new Error('disk failure'))
    logError.mockImplementationOnce(() => { throw new Error('log failure') })
    await expect(runtime.runWorkflowByRef('workflow')).rejects.toThrow('log failure')
    expect((await runtime.status()).runningWorkflowIds).toEqual([])
    expect(await runtime.runWorkflowByRef('workflow')).toMatchObject({ ok: true, status: 'success' })
  })

  it('persists cancellation when the last executing node returns during abort', async () => {
    const { runtime, settings } = createFixture()
    const delay = settings().workflow.workflows[0].nodes.find((node) => node.type === 'delay')!
    if (delay.type === 'delay') delay.config.delayMs = 60_000
    const task = runtime.runWorkflowByRef('workflow')
    await vi.waitFor(async () => expect((await runtime.status()).nodeStatus.workflow.delay).toBe('running'))
    await runtime.stopWorkflow('workflow')
    expect(await task).toMatchObject({ ok: false, status: 'error', message: 'Canceled.' })
    expect(settings().workflow.workflows[0].runs[0]).toMatchObject({ status: 'error', message: 'Canceled.' })
  })
})
