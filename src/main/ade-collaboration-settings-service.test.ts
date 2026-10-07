import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonSettingsStore } from './settings-store'
import { createAdeCollaborationSettingsService } from './ade-collaboration-settings-service'
import { adeCollaborationMutationSchema } from './ipc/ade-collaboration-settings-schema'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-ade-settings-'))
  roots.push(root)
  const store = new JsonSettingsStore(root)
  await store.load()
  let generation = 0
  const onCommitted = vi.fn(() => ++generation)
  const service = createAdeCollaborationSettingsService({
    store,
    serializePersistence: (operation) => operation(),
    onCommitted
  })
  return { store, service, onCommitted }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('conditional ADE collaboration settings', () => {
  it('rejects the second editor after the first commits the same object', async () => {
    const { service, onCommitted } = await fixture()
    const first = await service.get()
    const second = await service.get()
    const saved = await service.save({
      expectedRevision: first.revision,
      value: { ...first.value, enabled: true }
    })
    expect(saved).toMatchObject({ ok: true, generation: 1, value: { enabled: true } })

    const conflict = await service.save({
      expectedRevision: second.revision,
      value: { ...second.value, limits: { softWorkers: 5, hardWorkers: 8 } }
    })
    expect(conflict).toMatchObject({ ok: false, kind: 'conflict', value: { enabled: true } })
    expect(onCommitted).toHaveBeenCalledTimes(1)
    expect((await service.get()).value.limits.softWorkers).toBe(first.value.limits.softWorkers)
  })

  it('ignores unrelated settings revisions and preserves those fields', async () => {
    const { store, service } = await fixture()
    const initial = await service.get()
    await store.patch({ agents: { kun: { ade: { notifications: { waiting: false } } } } })
    expect((await service.get()).revision).toBe(initial.revision)
    const result = await service.save({
      expectedRevision: initial.revision,
      value: { ...initial.value, limits: { softWorkers: 3, hardWorkers: 6 } }
    })
    expect(result.ok).toBe(true)
    expect((await store.load()).agents.kun.ade.notifications.waiting).toBe(false)
  })

  it('persists the routing rollback switches', async () => {
    const { store, service } = await fixture()
    const initial = await service.get()
    expect(initial.value).toMatchObject({ harnessRouter: true, deterministicHandoff: true })
    const result = await service.save({
      expectedRevision: initial.revision,
      value: { ...initial.value, harnessRouter: false, deterministicHandoff: false }
    })
    expect(result).toMatchObject({ ok: true, value: { harnessRouter: false, deterministicHandoff: false } })
    const ade = (await store.load()).agents.kun.ade
    expect(ade.harnessRouter).toBe(false)
    expect(ade.deterministicHandoff).toBe(false)
  })

  it('keeps a failed persistence from reserving an application generation', async () => {
    const { store, service, onCommitted } = await fixture()
    const initial = await service.get()
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(service.save({
      expectedRevision: initial.revision,
      value: { ...initial.value, enabled: true }
    })).rejects.toThrow('disk unavailable')
    expect(onCommitted).not.toHaveBeenCalled()
    expect((await service.get()).value.enabled).toBe(false)
  })

  it('rejects secrets, executable paths, and inconsistent limits at the IPC boundary', async () => {
    const { service } = await fixture()
    const initial = await service.get()
    expect(adeCollaborationMutationSchema.safeParse({
      expectedRevision: initial.revision,
      value: { ...initial.value, command: '/usr/bin/agent' }
    }).success).toBe(false)
    expect(adeCollaborationMutationSchema.safeParse({
      expectedRevision: initial.revision,
      value: { ...initial.value, limits: { softWorkers: 9, hardWorkers: 8 } }
    }).success).toBe(false)
  })
})
