import type { DelegationRuntime } from './runtime-factory-dependencies.js'

/** Exposes staged schema values without mutating the active DelegationRuntime. */
export function delegationRuntimeConfigView<TConfig extends {
  enabled: boolean
  useExistingAgents: boolean
  defaultProfile?: string
  defaultToolPolicy: unknown
}>(runtime: DelegationRuntime | undefined, config: TConfig | undefined): DelegationRuntime | undefined {
  if (!runtime || !config) return undefined
  return new Proxy(runtime, {
    get(target, property) {
      if (property === 'enabled') return () => config.enabled
      if (property === 'useExistingAgents') return config.useExistingAgents
      if (property === 'defaultProfileName') return config.defaultProfile
      if (property === 'defaultToolPolicy') return config.defaultToolPolicy
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
