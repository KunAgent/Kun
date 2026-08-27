import {
  type AppSettingsV1
} from '@shared/app-settings'
import { useCallback, useEffect } from 'react'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  applyChatContentMaxWidth,
  applyCursorSpotlight,
  applyCursorSpotlightColor,
  applyDarkUiColors,
  applyTheme,
  applyUiFontScale,
  applyWriteTypography
} from '../lib/apply-theme'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'
import {
  coerceRendererSettings
} from './settings-utils'

export function useSettingsViewBootstrap(scope: Record<string, any>): { loadWriteDebugEntries: () => Promise<void> } {
  const { category, setCategory, form, setForm, setLoadError, setLogPath, setWriteCompletionDebugEntries, setWriteCompletionDebugSelectedId, setWriteDebugLoading, setWriteDebugError, extensionContributionSnapshotReady, extensionSettingsAvailable, settingsScrollerRef, persistedSettingsRef, formTheme, formUiFontScale, formChatContentMaxWidthPx, writeTypography, formCursorSpotlight, formCursorSpotlightColor, formDarkUiColors } = scope
  useEffect(() => {
    if (
      category === 'extensions' &&
      extensionContributionSnapshotReady &&
      !extensionSettingsAvailable
    ) setCategory('general')
  }, [category, extensionContributionSnapshotReady, extensionSettingsAvailable])

  useEffect(() => {
    let cancelled = false
    if (typeof window.kunGui === 'undefined') {
      setLoadError('PRELOAD_BRIDGE')
      return
    }
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
      .then((s) => {
        if (!cancelled) {
          const next = coerceRendererSettings(s)
          persistedSettingsRef.current = next
          setForm(next)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!formTheme || formUiFontScale == null || formChatContentMaxWidthPx == null) return
    applyTheme(formTheme)
    applyUiFontScale(formUiFontScale)
    applyChatContentMaxWidth(formChatContentMaxWidthPx)
  }, [formTheme, formUiFontScale, formChatContentMaxWidthPx])

  useEffect(() => {
    if (typeof formCursorSpotlight === 'boolean') {
      applyCursorSpotlight(formCursorSpotlight)
    }
    applyCursorSpotlightColor(formCursorSpotlightColor)
  }, [formCursorSpotlight, formCursorSpotlightColor])

  useEffect(() => {
    applyDarkUiColors(formDarkUiColors)
  }, [formDarkUiColors])

  // Live-preview the Write editor typography as the form changes, mirroring the
  // theme/scale preview above.
  useEffect(() => {
    if (writeTypography) applyWriteTypography(writeTypography)
  }, [writeTypography])

  useEffect(() => {
    const onSettingsChanged = (event: Event): void => {
      const next = (event as CustomEvent<AppSettingsV1>).detail
      if (next) {
        const coerced = coerceRendererSettings(next)
        persistedSettingsRef.current = coerced
        setForm(coerced)
      }
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])

  useEffect(() => {
    if (typeof window.kunGui?.getLogPath !== 'function') return
    void window.kunGui.getLogPath().then((p) => setLogPath(p)).catch(() => undefined)
  }, [category])

  const loadWriteDebugEntries = useCallback(async (): Promise<void> => {
    setWriteDebugLoading(true)
    setWriteDebugError(null)
    try {
      const completionEntries = typeof window.kunGui?.listWriteInlineCompletionDebugEntries === 'function'
        ? await window.kunGui.listWriteInlineCompletionDebugEntries()
        : []
      setWriteCompletionDebugEntries(completionEntries)
      setWriteCompletionDebugSelectedId((current: string | null) =>
        current && completionEntries.some((entry) => entry.id === current)
          ? current
          : completionEntries[0]?.id ?? null
      )
    } catch (error) {
      setWriteDebugError(error instanceof Error ? error.message : String(error))
    } finally {
      setWriteDebugLoading(false)
    }
  }, [])

  useEffect(() => {
    if (category !== 'write') return
    void loadWriteDebugEntries()
  }, [category, loadWriteDebugEntries])

  useEffect(() => {
    settingsScrollerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [category])
  return { loadWriteDebugEntries }
}
