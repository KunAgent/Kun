import { create } from 'zustand'
import type { HarnessSessionSetting } from '../../../../kun/src/contracts/harness-session-settings'
import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

/**
 * Composer values for the settings an external Agent publishes beyond model,
 * permission mode and reasoning (docs/ade/17 §4.4). Kept per harness like the
 * native Agent pick; an absent value keeps the Agent's own.
 */
const STORAGE_KEY = 'kun.harnessSessionSettings.v1'

type SettingValue = string | boolean
type Values = Record<string, Record<string, SettingValue>>

function load(): Values {
  try {
    const parsed: unknown = JSON.parse(readBrowserStorageItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Values = {}
    for (const [harnessId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const values = Object.fromEntries(Object.entries(entry as Record<string, unknown>)
        .filter((pair): pair is [string, SettingValue] => typeof pair[1] === 'string' || typeof pair[1] === 'boolean'))
      if (Object.keys(values).length) out[harnessId] = values
    }
    return out
  } catch {
    return {}
  }
}

export const useHarnessSessionSettingsStore = create<{ values: Values }>(() => ({ values: load() }))

/** `undefined` returns the setting to the Agent's own value. */
export function setHarnessSessionSetting(harnessId: string, settingId: string, value: SettingValue | undefined): void {
  const id = harnessId.trim()
  if (!id || id === 'kun' || !settingId) return
  const values = { ...useHarnessSessionSettingsStore.getState().values }
  const next = { ...values[id] }
  if (value === undefined) delete next[settingId]
  else next[settingId] = value
  if (Object.keys(next).length) values[id] = next
  else delete values[id]
  useHarnessSessionSettingsStore.setState({ values })
  writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(values))
}

/** Turn-request field; the runtime skips values the session does not offer. */
export function harnessSettingsRequestField(harnessId: string | undefined): { harnessSettings?: Record<string, SettingValue> } {
  const values = harnessId?.trim() ? useHarnessSessionSettingsStore.getState().values[harnessId.trim()] : undefined
  return values && Object.keys(values).length ? { harnessSettings: { ...values } } : {}
}

/** The live session's list (current values) wins over a fresh session's from the catalog. */
export function harnessSessionSettingOptions(input: {
  sessionSettings?: readonly HarnessSessionSetting[]
  catalogSettings?: readonly HarnessSessionSetting[]
}): HarnessSessionSetting[] {
  return [...(input.sessionSettings?.length ? input.sessionSettings : input.catalogSettings ?? [])]
}

/** The value the next turn uses: the composer's pick when the Agent still offers it. */
export function effectiveSettingValue(setting: HarnessSessionSetting, picked: SettingValue | undefined): SettingValue {
  if (setting.kind === 'toggle') return typeof picked === 'boolean' ? picked : setting.value
  return typeof picked === 'string' && setting.options.some((option) => option.value === picked) ? picked : setting.value
}
