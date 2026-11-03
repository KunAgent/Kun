import type { ExtensionRegistry } from './registry.js'
import { checkEnablement, enablementProof, EnablementRejected, type EnablementControl } from './enablement-control.js'
type Dependencies = { registry: ExtensionRegistry; recover(id: string): Promise<void>;
  serialize<T>(id: string, work: () => Promise<T>): Promise<T>;
  beforeDisable?(id: string, workspaceKey?: string, workspaceRoot?: string): Promise<void> }
export async function setGlobalEnabled(deps: Dependencies, id: string, enabled: boolean, control?: EnablementControl) {
  if (control) {
    const entry = await deps.registry.get(id)
    checkEnablement(entry, control, enabled)
    if (enablementProof(entry!, control, enabled)) return
  }
  await deps.recover(id)
  await deps.serialize(id, async () => {
    if (control) {
      const entry = await deps.registry.get(id)
      // Recovery may itself have changed selected-version state; uncertainty is preserved.
      try { checkEnablement(entry, control, enabled) }
      catch (error) { if (error instanceof EnablementRejected) throw new EnablementRejected(error.code, false); throw error }
      if (enablementProof(entry!, control, enabled)) return
    }
    if (!enabled) await deps.beforeDisable?.(id)
    try { await deps.registry.setGlobalEnabled(id, enabled, control) }
    catch (error) { if (error instanceof EnablementRejected) throw new EnablementRejected(error.code, false); throw error }
  })
}
export async function setWorkspaceEnabled(deps: Dependencies, id: string, key: string, enabled: boolean | undefined, root?: string) {
  await deps.recover(id)
  await deps.serialize(id, async () => {
    if (enabled === false) await deps.beforeDisable?.(id, key, root)
    await deps.registry.setWorkspaceEnabled(id, key, enabled)
  })
}
