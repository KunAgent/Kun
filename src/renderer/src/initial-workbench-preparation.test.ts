import { describe, expect, it, vi } from 'vitest'
import { createInitialWorkbenchPreparer } from './initial-workbench-preparation'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function createDeps(overrides: { route?: string; initialSetupOpen?: boolean } = {}) {
  return {
    boot: vi.fn<() => Promise<void>>(async () => undefined),
    getSnapshot: vi.fn(() => ({
      route: overrides.route ?? 'chat',
      initialSetupOpen: overrides.initialSetupOpen ?? false
    })),
    loadWorkbench: vi.fn<() => Promise<unknown>>(async () => undefined),
    loadSettingsView: vi.fn<() => Promise<unknown>>(async () => undefined),
    loadInitialSetupDialog: vi.fn<() => Promise<unknown>>(async () => undefined)
  }
}

describe('initial workbench preparation', () => {
  it('boots once and shares a concurrent preparation', async () => {
    const pendingBoot = deferred()
    const deps = createDeps()
    deps.boot.mockReturnValueOnce(pendingBoot.promise)
    const prepare = createInitialWorkbenchPreparer(deps)

    const first = prepare()
    const second = prepare()
    expect(second).toBe(first)
    expect(deps.boot).toHaveBeenCalledTimes(1)
    expect(deps.loadWorkbench).not.toHaveBeenCalled()

    pendingBoot.resolve()
    await first
    expect(deps.loadWorkbench).toHaveBeenCalledTimes(1)
    expect(deps.loadSettingsView).not.toHaveBeenCalled()
  })

  it('preloads settings and initial setup from the post-boot snapshot', async () => {
    const deps = createDeps({ route: 'settings', initialSetupOpen: true })
    const prepare = createInitialWorkbenchPreparer(deps)

    await prepare()

    expect(deps.loadSettingsView).toHaveBeenCalledTimes(1)
    expect(deps.loadInitialSetupDialog).toHaveBeenCalledTimes(1)
    expect(deps.loadWorkbench).not.toHaveBeenCalled()
  })

  it('preloads the final route and setup state after deferred imports', async () => {
    let snapshot = { route: 'chat', initialSetupOpen: false }
    const pendingWorkbench = deferred()
    const deps = createDeps()
    deps.getSnapshot.mockImplementation(() => snapshot)
    deps.loadWorkbench.mockReturnValueOnce(pendingWorkbench.promise)
    const prepare = createInitialWorkbenchPreparer(deps)

    const preparation = prepare()
    await Promise.resolve()
    expect(deps.loadWorkbench).toHaveBeenCalledTimes(1)
    snapshot = { route: 'settings', initialSetupOpen: true }
    pendingWorkbench.resolve()
    await preparation

    expect(deps.loadSettingsView).toHaveBeenCalledTimes(1)
    expect(deps.loadInitialSetupDialog).toHaveBeenCalledTimes(1)
    expect(deps.loadWorkbench).toHaveBeenCalledTimes(1)
  })

  it('allows retry after a failed preparation', async () => {
    const deps = createDeps()
    deps.loadWorkbench.mockRejectedValueOnce(new Error('chunk unavailable'))
    const prepare = createInitialWorkbenchPreparer(deps)

    await expect(prepare()).rejects.toThrow('chunk unavailable')
    await prepare()

    expect(deps.boot).toHaveBeenCalledTimes(2)
    expect(deps.loadWorkbench).toHaveBeenCalledTimes(2)
  })
})
