import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { agentSdkProviderIdsForOptions, antigravityProviderIdsForOptions,
  cursorSdkProviderIdsForOptions } from './runtime-factory-model.js'

/** Refresh mutable native-provider identity sets after a Registry configuration replacement. */
export function refreshRuntimeProviderIdentitySets(options: KunServeRuntimeOptions, sets: {
  agentSdk: Set<string>; antigravity: Set<string>; cursorSdk: Set<string>
}): void {
  for (const [target, values] of [
    [sets.agentSdk, agentSdkProviderIdsForOptions(options)],
    [sets.antigravity, antigravityProviderIdsForOptions(options)],
    [sets.cursorSdk, cursorSdkProviderIdsForOptions(options)]
  ] as const) {
    target.clear()
    for (const value of values) target.add(value)
  }
}
