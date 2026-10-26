import type { HarnessDefinition } from '../contracts/harness.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import { providerModuleFor } from './providers/registry.js'

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
