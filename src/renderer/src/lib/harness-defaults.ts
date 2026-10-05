import { useEffect, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { KunHarnessDefaultsEntryV1 } from '@shared/app-settings-types-kun-runtime'
import {
  KUN_TOOL_PERMISSION_MODES,
  kunToolPermissionModeSettings,
  type KunToolPermissionMode,
  type KunToolPermissionSettings
} from '@shared/app-settings'
import type { AdeHarnessDefinition } from '@shared/ade-harnesses'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { applyHarnessEnablementSettings, loadHarnesses } from '../store/harness-store'
import { SETTINGS_CHANGED_EVENT } from './keyboard-shortcut-settings'

/**
 * `agents.kun.harnesses.defaults` (docs/ade/impl/p4 §3.6, P4-11) reader for
 * the workbench: the composer harness picker, the one-to-one creation path,
 * and the Agent Center all fall back to these when nothing was picked
 * explicitly. Mirrors the `use-ade-enabled` load-then-subscribe pattern.
 */
export function harnessDefaultsFromApp(
  settings: AppSettingsV1
): Record<string, KunHarnessDefaultsEntryV1> {
  return getKunRuntimeSettings(settings).harnesses?.defaults ?? {}
}

/** Module-level snapshot so non-hook callbacks can read the latest values. */
let snapshot: Record<string, KunHarnessDefaultsEntryV1> = {}

export function harnessDefaultsSnapshot(): Record<string, KunHarnessDefaultsEntryV1> {
  return snapshot
}

/**
 * Resolve `defaults[harnessId].permissionMode` (a harness-native level id
 * like `acceptEdits`) to the composer execution-settings triple, via the
 * definition's `kunPermissionMode` annotation. Undefined when the default
 * is absent or does not name a declared mode.
 */
export function harnessPermissionDefault(
  definition: Pick<AdeHarnessDefinition, 'permissionModes'> | undefined,
  defaults: KunHarnessDefaultsEntryV1 | undefined
): KunToolPermissionSettings | undefined {
  const entry = definition?.permissionModes?.find(
    (mode) => mode.id === defaults?.permissionMode
  )
  const kunMode = entry?.kunPermissionMode
  if (
    !kunMode ||
    !(KUN_TOOL_PERMISSION_MODES as readonly string[]).includes(kunMode)
  ) return undefined
  return kunToolPermissionModeSettings(kunMode as KunToolPermissionMode)
}

export function useHarnessDefaults(enabled = true): Record<string, KunHarnessDefaultsEntryV1> {
  const [defaults, setDefaults] =
    useState<Record<string, KunHarnessDefaultsEntryV1>>(snapshot)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (cancelled) return
      snapshot = harnessDefaultsFromApp(settings)
      setDefaults(snapshot)
    }
    try {
      void rendererRuntimeClient.getSettings().then(apply).catch(() => undefined)
    } catch {
      // Bridge unavailable (unit tests): keep the empty snapshot.
    }
    const onSettingsChanged = (event: Event): void => {
      const settings = (event as CustomEvent<AppSettingsV1>).detail
      if (settings) {
        apply(settings)
        applyHarnessEnablementSettings(getKunRuntimeSettings(settings).harnesses, true)
        void loadHarnesses(true)
      }
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    const stopSync = window.kunGui?.onRuntimeSettingsSyncStatus?.((status) => {
      if (status.state === 'synced') void loadHarnesses(true)
    })
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
      stopSync?.()
    }
  }, [enabled])

  return defaults
}
