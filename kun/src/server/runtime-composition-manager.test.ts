import { describe, expect, it, vi } from 'vitest'
import { createManagerRuntime } from './runtime-composition-manager.js'

describe('createManagerRuntime', () => {
  it('keeps the wake-up coordinator as the manager notice sink over the raw store', () => {
    const coordinator = { enqueue: vi.fn() }
    const rawStore = { enqueue: vi.fn() }
    const runtime = createManagerRuntime({
      services: {
        adeStores: { teams: {}, dispatches: {}, questions: {}, notices: rawStore, reviews: {}, races: {} },
        harnesses: { catalog: {}, detector: {} },
        workerCallbacks: {},
        attribution: {}
      },
      core: { events: { addObserver: vi.fn() }, taskWorkspaces: {}, activeOptions: {}, modelCapabilities: vi.fn() },
      harnessRuntimeMap: {},
      agentRoster: {},
      listQuota: vi.fn(),
      notices: coordinator,
      threads: {},
      nowIso: () => '2026-10-23T00:00:00.000Z'
    } as never)
    expect((runtime as unknown as { deps: { notices: unknown } }).deps.notices).toBe(coordinator)
  })
})
