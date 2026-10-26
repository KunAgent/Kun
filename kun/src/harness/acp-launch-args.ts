import type { HarnessDefinition } from '../contracts/harness.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import { providerModuleFor } from './providers/registry.js'

/** Repository-owned legacy mappings (e.g. Devin normal) remain known, not user assertions. */
export function customAcpPermission(mode: string | undefined, definition?: HarnessDefinition): boolean {
  const requested = mode?.trim()
  if (!requested || definition?.permissionModes.some(entry => entry.id === requested)) return false
  if (definition && providerModuleFor(definition)?.permissionMode?.({ requested, ceiling: 2 })) return false
  return definition ? true : requested !== 'default'
}

/** Preserve whether a mode came from explicit configuration, not a provider's automatic mapping. */
export function acpPermissionSelection(definition: HarnessDefinition, permissionModeId: string | undefined, requested?: string) {
  return { permissionModeId, customPermissionMode: customAcpPermission(requested, definition) }
}

/** Shared by readiness and execution; only the resolved permission may shape launch. */
export function acpLaunchArgs(definition: HarnessDefinition, permissionMode?: string): string[] {
  const args = definition.launch?.args ?? []
  return providerModuleFor(definition)?.acp?.launchArgs?.(args, permissionMode) ?? args
}

/** A process started at one permission level cannot serve a different launch mode. */
export function acpLaunchIdentity(command: string | undefined, definition: HarnessDefinition, permissionMode?: string): string {
  const executable = harnessExecutableIdentity(command)
  return providerModuleFor(definition)?.acp?.launchArgs
    ? `${executable}:args:${JSON.stringify(acpLaunchArgs(definition, permissionMode))}` : executable
}
