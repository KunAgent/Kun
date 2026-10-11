import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMemoryLifecycle, loadMemoryHistory } from './kun-runtime-memory-lifecycle'
import type { CoreMemoryRecordJson } from './kun-contract'
const record: CoreMemoryRecordJson = { id: 'memory one', revision: 7, content: 'Project evidence', scope: 'project', project: '/repo a', createdAt: '', updatedAt: '' }
afterEach(() => vi.unstubAllGlobals())
describe('memory lifecycle IPC transport', () => {
  it('binds action to selected revision, exact project scope and explicit erase confirmation', async () => {
    const runtimeRequest = vi.fn().mockResolvedValue({ ok: true, body: JSON.stringify({ erased: true, affectedIds: [record.id] }) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    await expect(applyMemoryLifecycle(record, { action: 'erase', confirmation: { memoryId: record.id, irreversible: true } })).resolves.toMatchObject({ erased: true })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/memory/memory%20one/lifecycle?project=%2Frepo+a', 'POST', JSON.stringify({
      action: 'erase', confirmation: { memoryId: record.id, irreversible: true }, expectedRevision: 7
    }))
  })
  it('reads history only through the exact scoped memory endpoint', async () => {
    const runtimeRequest = vi.fn().mockResolvedValue({ ok: true, body: JSON.stringify({ memoryId: record.id, revision: 7, history: [] }) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    await expect(loadMemoryHistory(record)).resolves.toEqual([])
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/memory/memory%20one/history?project=%2Frepo+a', 'GET')
  })
  it('does not silently retry a stale revision', async () => {
    const runtimeRequest = vi.fn().mockResolvedValue({ ok: false, body: JSON.stringify({ error: { code: 'conflict', message: 'stale memory revision' } }) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    await expect(applyMemoryLifecycle(record, { action: 'rollback', targetRevision: 3 })).rejects.toThrow()
    expect(runtimeRequest).toHaveBeenCalledOnce()
  })
})
