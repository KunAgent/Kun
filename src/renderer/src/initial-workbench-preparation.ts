export type InitialWorkbenchPreparationSnapshot = {
  route: string
  initialSetupOpen: boolean
}

export type InitialWorkbenchPreparationDeps = {
  boot: () => Promise<void>
  getSnapshot: () => InitialWorkbenchPreparationSnapshot
  loadWorkbench: () => Promise<unknown>
  loadSettingsView: () => Promise<unknown>
  loadInitialSetupDialog: () => Promise<unknown>
}

const MAX_STABILITY_ATTEMPTS = 3

function sameSnapshot(
  before: InitialWorkbenchPreparationSnapshot,
  after: InitialWorkbenchPreparationSnapshot
): boolean {
  return before.route === after.route && before.initialSetupOpen === after.initialSetupOpen
}

async function preloadSnapshot(
  deps: InitialWorkbenchPreparationDeps,
  snapshot: InitialWorkbenchPreparationSnapshot
): Promise<void> {
  await Promise.all([
    snapshot.route === 'settings' ? deps.loadSettingsView() : deps.loadWorkbench(),
    snapshot.initialSetupOpen ? deps.loadInitialSetupDialog() : Promise.resolve()
  ])
}

export function createInitialWorkbenchPreparer(
  deps: InitialWorkbenchPreparationDeps
): () => Promise<void> {
  let activePreparation: Promise<void> | null = null
  return () => {
    if (activePreparation) return activePreparation
    const preparation = (async () => {
      await deps.boot()
      for (let attempt = 0; attempt < MAX_STABILITY_ATTEMPTS; attempt += 1) {
        const before = deps.getSnapshot()
        await preloadSnapshot(deps, before)
        if (sameSnapshot(before, deps.getSnapshot())) return
      }
    })()
    activePreparation = preparation
    void preparation.catch(() => {
      if (activePreparation === preparation) activePreparation = null
    })
    return preparation
  }
}
