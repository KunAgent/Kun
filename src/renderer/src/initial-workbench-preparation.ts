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

export function createInitialWorkbenchPreparer(
  deps: InitialWorkbenchPreparationDeps
): () => Promise<void> {
  let activePreparation: Promise<void> | null = null
  return () => {
    if (activePreparation) return activePreparation
    const preparation = (async () => {
      await deps.boot()
      const { route, initialSetupOpen } = deps.getSnapshot()
      const routeComponent = route === 'settings'
        ? deps.loadSettingsView()
        : deps.loadWorkbench()
      const setupComponent = initialSetupOpen
        ? deps.loadInitialSetupDialog()
        : Promise.resolve()
      await Promise.all([routeComponent, setupComponent])
      const finalSnapshot = deps.getSnapshot()
      if (finalSnapshot.route !== route || finalSnapshot.initialSetupOpen !== initialSetupOpen) {
        await Promise.all([
          finalSnapshot.route === 'settings' ? deps.loadSettingsView() : deps.loadWorkbench(),
          finalSnapshot.initialSetupOpen ? deps.loadInitialSetupDialog() : Promise.resolve()
        ])
      }
    })()
    activePreparation = preparation
    void preparation.catch(() => {
      if (activePreparation === preparation) activePreparation = null
    })
    return preparation
  }
}
