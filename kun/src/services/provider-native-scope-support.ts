import type { ProviderAuthProfile, ProviderHeaderProfile } from '../contracts/provider-configuration.js'

/** Native adapters own inference/login. Their legacy behavior cannot pretend to enforce HTTP scopes. */
export function assertProviderNativeScopeSupport(kind: string | undefined, authProfile?: ProviderAuthProfile, headerProfile?: ProviderHeaderProfile): void {
  if (!kind || kind === 'http') return
  if (headerProfile || authProfile && (authProfile.mode !== 'adapter' || authProfile.scope.purposes.some((purpose) => purpose !== 'quota'))) {
    throw new Error('Unsupported native provider scopes. This adapter manages inference and OAuth internally; only an adapter-owned quota scope can be configured here. Remove the unsupported profile before applying this configuration.')
  }
}
