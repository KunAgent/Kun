import type { AppSettingsPatch, AppSettingsV1 } from '../shared/app-settings-types'
import type { KunRuntimeStatusPayload } from '../shared/kun-gui-api'
import {
  applyKunRuntimePatch,
  getKunRuntimeSettings,
  getModelProviderProfile,
  getModelProviderSettings,
  mergeModelProviderSettings,
  resolveKunRuntimeSettings
} from '../shared/app-settings'
import { clawScheduleMcpSettingsChanged } from './claw-schedule-mcp-config'

export type RuntimeSettingsApplyMode = 'none' | 'hot' | 'restart'

export function runtimeSettingsRollbackPatch(
  previousWorking: AppSettingsV1,
  desired: AppSettingsV1
): AppSettingsPatch {
  return {
    agents: { kun: getKunRuntimeSettings(previousWorking) },
    provider: {
      ...previousWorking.provider,
      routePools: desired.provider.routePools,
      localGateway: desired.provider.localGateway
    }
  }
}

export function applyRuntimeSettingsRollback(
  current: AppSettingsV1,
  previousWorking: AppSettingsV1,
  desired: AppSettingsV1
): AppSettingsV1 {
  const patch = runtimeSettingsRollbackPatch(previousWorking, desired)
  const withKun = applyKunRuntimePatch(current, patch.agents?.kun)
  return {
    ...withKun,
    provider: mergeModelProviderSettings(current.provider, patch.provider)
  }
}

export type RuntimeRollbackTerminalOutcome =
  | { kind: 'stopped' }
  | { kind: 'running' }
  | { kind: 'superseded' }
  | { kind: 'restore_failed'; detail: string }
  | { kind: 'commit_failed'; detail: string }

export function runtimeRollbackTerminalStatus(input: {
  outcome: RuntimeRollbackTerminalOutcome
  isCurrent: boolean
  applyFailure: string
}): Omit<KunRuntimeStatusPayload, 'at'> {
  const { outcome, isCurrent, applyFailure } = input
  if (outcome.kind === 'commit_failed') {
    return {
      state: 'failed',
      source: 'settings-apply-rollback',
      message: `The new settings failed to apply (${applyFailure}) and the previous settings could not be restored on disk: ${outcome.detail}`
    }
  }
  if (outcome.kind === 'superseded') {
    return {
      state: 'failed',
      source: 'settings-apply-rollback',
      message: `The Runtime settings apply failed (${applyFailure}) and a newer durable settings snapshot superseded its rollback; Runtime availability is pending reconciliation.`
    }
  }
  if (outcome.kind === 'stopped') {
    return isCurrent
      ? {
          state: 'stopped',
          source: 'settings-apply',
          rolledBack: true,
          message: `The new settings failed to apply (${applyFailure}); previous settings were restored but auto-start is unavailable.`
        }
      : {
          state: 'stopped',
          source: 'settings-apply',
          message: 'Kun is stopped because automatic startup is disabled; newer settings remain durable.'
        }
  }
  if (outcome.kind === 'running') {
    return isCurrent
      ? {
          state: 'running',
          source: 'settings-apply',
          rolledBack: true,
          message: `The new settings failed to apply (${applyFailure}); Kun is running on the previous settings again.`
        }
      : {
          state: 'running',
          source: 'settings-apply-rollback'
        }
  }
  return isCurrent
    ? {
        state: 'failed',
        source: 'settings-apply',
        rolledBack: true,
        message: `The new settings failed to apply (${applyFailure}) and restoring the previous settings also failed: ${outcome.detail}`
      }
    : {
        state: 'failed',
        source: 'settings-apply-rollback',
        message: `Kun is unavailable after a failed settings rollback (${outcome.detail}); newer settings remain durable.`
      }
}

/**
 * A rollback may only touch the exact Runtime/provider snapshot whose apply
 * failed. Top-level unrelated settings are intentionally ignored because the
 * rollback patch does not modify them.
 */
export function runtimeRollbackTargetUnchanged(
  current: AppSettingsV1,
  failedDesired: AppSettingsV1
): boolean {
  return stableSettingsValueEqual(
    {
      kun: getKunRuntimeSettings(current),
      provider: current.provider
    },
    {
      kun: getKunRuntimeSettings(failedDesired),
      provider: failedDesired.provider
    }
  )
}

/**
 * Stable equality for the Kun runtime settings. Most fields are flat,
 * but GUI-managed capability options can be nested, so compare values
 * structurally while still surviving future field additions.
 */
export function kunRuntimeConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  const a = resolveKunRuntimeSettings(prev)
  const b = resolveKunRuntimeSettings(next)
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof typeof a>)
  for (const key of keys) {
    if (!stableSettingsValueEqual(a[key], b[key])) return true
  }
  return false
}

export function stableSettingsStringify(value: unknown): string {
  return JSON.stringify(canonicalSettingsValue(value))
}

export function runtimeProcessConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return runtimeProcessConfigFingerprint(prev) !== runtimeProcessConfigFingerprint(next)
}

export function runtimeSettingsApplyMode(prev: AppSettingsV1, next: AppSettingsV1): RuntimeSettingsApplyMode {
  if (runtimeProcessConfigChanged(prev, next)) return 'restart'
  if (runtimeHotConfigChanged(prev, next)) return 'hot'
  return 'none'
}

function runtimeProcessConfigFingerprint(settings: AppSettingsV1): string {
  const runtime = getKunRuntimeSettings(settings)
  const activeProvider = getModelProviderProfile(settings, runtime.providerId)
  return stableSettingsStringify({
    binaryPath: runtime.binaryPath.trim(),
    port: runtime.port,
    autoStart: runtime.autoStart,
    runtimeToken: runtime.runtimeToken.trim(),
    dataDir: runtime.dataDir.trim(),
    storage: runtime.storage,
    insecure: runtime.insecure,
    defaultProviderKind: activeProvider.kind ?? 'http',
    computerUse: {
      enabled: runtime.computerUse.enabled,
      maxImageDimension: runtime.computerUse.maxImageDimension
    }
  })
}

function runtimeHotConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return kunRuntimeConfigChanged(prev, next) ||
    modelProviderRuntimeConfigChanged(prev, next) ||
    clawScheduleMcpSettingsChanged(prev, next)
}

function modelProviderRuntimeConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  const a = getModelProviderSettings(prev)
  const b = getModelProviderSettings(next)
  if (!stableSettingsValueEqual(a.proxy, b.proxy)) return true
  if (!stableSettingsValueEqual(a.routePools, b.routePools)) return true
  if (a.localGateway.enabled !== b.localGateway.enabled) return true

  const aProviders = new Map(a.providers.map((provider) => [provider.id.trim(), provider]))
  const bProviders = new Map(b.providers.map((provider) => [provider.id.trim(), provider]))
  if (aProviders.size !== bProviders.size) return true

  for (const [providerId, aProvider] of aProviders) {
    const bProvider = bProviders.get(providerId)
    if (!bProvider) return true
    // Compare credential rotations without placing secrets in a serialized
    // fingerprint, diagnostic object, or persisted settings projection.
    if (aProvider.apiKey.trim() !== bProvider.apiKey.trim()) return true
    if (!stableSettingsValueEqual(
      providerRuntimeTransportConfig(aProvider),
      providerRuntimeTransportConfig(bProvider)
    )) return true
  }
  return false
}

function providerRuntimeTransportConfig(
  provider: ReturnType<typeof getModelProviderSettings>['providers'][number]
): Record<string, unknown> {
  return {
    baseUrl: provider.baseUrl.trim(),
    endpointFormat: provider.endpointFormat,
    retry: provider.retry,
    kind: provider.kind ?? 'http'
  }
}

function stableSettingsValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return stableSettingsStringify(a) === stableSettingsStringify(b)
}

function canonicalSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSettingsValue)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalSettingsValue((value as Record<string, unknown>)[key])
  }
  return out
}
