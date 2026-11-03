import { providerModule } from './providers/registry.js'

/** Host-owned recipes only. Neither providers nor renderer requests supply commands/URLs. */
export type HarnessUpdateRecipe = { command: string; packageName?: string; tag?: string; cask?: string; nativeArgs?: string[] }

/** The engine module's update recipe; custom Agents have none. */
export function harnessUpdateRecipe(id: string): HarnessUpdateRecipe | undefined {
  return providerModule(id)?.update
}
