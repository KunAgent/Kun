import {
  getKunRuntimeSettings,
  MIN_KUN_LOCAL_PORT,
  resolveKunRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'

export function validateRuntimeSettingsForApply(next: AppSettingsV1): string | null {
  const runtime = resolveKunRuntimeSettings(next)
  if (!Number.isInteger(runtime.port) || runtime.port < MIN_KUN_LOCAL_PORT || runtime.port > 65_535) {
    return `Kun port must be an integer between ${MIN_KUN_LOCAL_PORT} and 65535 (got ${String(runtime.port)})`
  }
  const baseUrl = (runtime.baseUrl ?? '').trim()
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `model base URL must use http(s): ${baseUrl}`
      }
    } catch {
      return `model base URL is not a valid URL: ${baseUrl}`
    }
  }
  return null
}

export function preserveRuntimeTokenForFullSettingsSnapshot(
  prev: AppSettingsV1,
  partial: AppSettingsPatch
): AppSettingsPatch {
  const incomingKun = partial.agents?.kun
  if (!incomingKun || !isFullSettingsSnapshotPatch(partial)) return partial
  if (typeof incomingKun.runtimeToken !== 'string' || incomingKun.runtimeToken.trim()) return partial

  const currentToken = getKunRuntimeSettings(prev).runtimeToken.trim()
  if (!currentToken) return partial

  return {
    ...partial,
    agents: {
      ...partial.agents,
      kun: {
        ...incomingKun,
        runtimeToken: currentToken
      }
    }
  }
}

function isFullSettingsSnapshotPatch(partial: AppSettingsPatch): boolean {
  return partial.version !== undefined &&
    partial.provider !== undefined &&
    partial.agents?.kun !== undefined &&
    partial.log !== undefined &&
    partial.checkpointCleanup !== undefined &&
    partial.notifications !== undefined &&
    partial.appBehavior !== undefined &&
    partial.keyboardShortcuts !== undefined &&
    partial.write !== undefined &&
    partial.claw !== undefined &&
    partial.schedule !== undefined &&
    partial.workflow !== undefined &&
    partial.terminal !== undefined &&
    partial.guiUpdate !== undefined
}
