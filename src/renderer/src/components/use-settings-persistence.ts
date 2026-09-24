import {
  type AppSettingsPatch,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { isRemoteWeb, readRemoteLocaleOverride } from '../lib/remote-mobile'
import {
  expandSettingsHomePathsForUse
} from '../lib/settings-home-paths'
import {
  coerceRendererSettings,
  diffSettingsPatch,
  hasValidPort
} from './settings-utils'
import { parseSettingsSaveIssue } from './settings-save-error'

type SettingsPatch = AppSettingsPatch

export function useSettingsPersistence(scope: Record<string, any>): Record<string, any> {
  const { closeSettings, openInitialSetup, applyI18n, reloadUiSettings, probeRuntime, form, setForm, setSaveStatus, setSaveError, setSaveIssue, saveTimer, statusTimer, draftVersion, pendingSnapshotRef, persistedSettingsRef, flushOnUnmountRef, settingsPlatform, settingsHomeDir } = scope
  const persistSettings = async (snapshot: AppSettingsV1, version: number): Promise<void> => {
    if (!hasValidPort(snapshot)) return
    setSaveStatus('saving')
    setSaveError(null)
    setSaveIssue(null)

    try {
      const expandedSnapshot = expandSettingsHomePathsForUse(snapshot, settingsHomeDir, settingsPlatform)
      const expandedBase = expandSettingsHomePathsForUse(
        persistedSettingsRef.current ?? snapshot,
        settingsHomeDir,
        settingsPlatform
      )
      const patch = diffSettingsPatch(expandedBase, expandedSnapshot)
      // A Remote client's language is per-device browser storage; persisting
      // it would relabel the host UI, and re-applying the host locale would
      // clobber the device pick.
      if (isRemoteWeb()) delete patch.locale
      const next = coerceRendererSettings(
        Object.keys(patch).length > 0
          ? await rendererRuntimeClient.setSettings(patch)
          : await rendererRuntimeClient.getSettings({ forceRefresh: true })
      )
      if (version !== draftVersion.current) return

      persistedSettingsRef.current = next
      setForm(next)
      emitRendererSettingsChanged(next)
      await applyI18n(readRemoteLocaleOverride() ?? next.locale)
      void reloadUiSettings()
      void probeRuntime('background')
      if (version !== draftVersion.current) return

      setSaveStatus('saved')
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
      statusTimer.current = window.setTimeout(() => {
        if (version === draftVersion.current) setSaveStatus('idle')
        statusTimer.current = null
      }, 1500)
    } catch (e) {
      if (version !== draftVersion.current) return
      const message = e instanceof Error ? e.message : String(e)
      setSaveError(message)
      setSaveIssue(parseSettingsSaveIssue(message, snapshot))
      setSaveStatus('error')
      void window.kunGui?.logError?.('settings', 'Failed to apply settings', { message }).catch(() => undefined)
    }
  }

  const scheduleSave = (next: AppSettingsV1): void => {
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (statusTimer.current) window.clearTimeout(statusTimer.current)
    statusTimer.current = null
    setSaveError(null)
    setSaveIssue(null)

    if (!hasValidPort(next)) {
      pendingSnapshotRef.current = null
      setSaveStatus('idle')
      return
    }

    pendingSnapshotRef.current = next
    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      pendingSnapshotRef.current = null
      void persistSettings(next, version)
    }, 450)
  }

  const flushPendingSave = async (): Promise<void> => {
    pendingSnapshotRef.current = null
    if (!form || !hasValidPort(form)) return
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (statusTimer.current) {
      window.clearTimeout(statusTimer.current)
      statusTimer.current = null
    }

    await persistSettings(form, version)
  }

  // Recomputed every render so the unmount cleanup always sees current values.
  // Persists the pending snapshot directly over IPC (no React state writes,
  // since the component is unmounting) and broadcasts the change so other
  // surfaces stay in sync.
  flushOnUnmountRef.current = (): void => {
    const snapshot = pendingSnapshotRef.current
    pendingSnapshotRef.current = null
    if (!snapshot || !hasValidPort(snapshot)) return
    const expandedSnapshot = expandSettingsHomePathsForUse(snapshot, settingsHomeDir, settingsPlatform)
    const expandedBase = expandSettingsHomePathsForUse(
      persistedSettingsRef.current ?? snapshot,
      settingsHomeDir,
      settingsPlatform
    )
    const patch = diffSettingsPatch(expandedBase, expandedSnapshot)
    if (isRemoteWeb()) delete patch.locale
    void rendererRuntimeClient
      .setSettings(patch)
      .then((saved) => {
        const next = coerceRendererSettings(saved)
        persistedSettingsRef.current = next
        emitRendererSettingsChanged(next)
        // App-wide effects the normal save path runs, so a last-moment locale or
        // UI-token edit still takes effect immediately rather than on next start.
        void applyI18n(readRemoteLocaleOverride() ?? next.locale)
        void reloadUiSettings()
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        void window.kunGui?.logError?.('settings', 'Failed to flush settings on unmount', { message }).catch(
          () => undefined
        )
      })
  }

  const goBack = (): void => {
    void (async () => {
      await flushPendingSave()
      await reloadUiSettings()
      closeSettings()
    })()
  }

  const openOnboardingPreview = (): void => {
    void (async () => {
      await flushPendingSave()
      openInitialSetup('preview')
    })()
  }
  return { scheduleSave, flushPendingSave, goBack, openOnboardingPreview }
}
