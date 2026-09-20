import { useCallback, useEffect, useState } from 'react'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { applyTheme } from '../../lib/apply-theme'
import { readFocusModePreference, writeFocusModePreference } from '../../lib/focus-mode'
import { useUiModeCameosEnabled, useUiPluginStore } from '../../store/ui-plugin-store'

export function useWorkbenchUiRuntime() {
  const initUiPlugins = useUiPluginStore((s) => s.initUiPlugins)
  const uiModeCameosEnabled = useUiModeCameosEnabled()
  const [focusModeEnabled, setFocusModeEnabled] = useState(readFocusModePreference)
  const [runtimeLogPath, setRuntimeLogPath] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.kunGui?.getLogPath !== 'function') return
    let cancelled = false
    void window.kunGui
      .getLogPath()
      .then((path) => {
        if (!cancelled) setRuntimeLogPath(path)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 形象工坊:读取偏好、应用 DOM 属性/token,并在插件模式下加载图集
    void initUiPlugins()
  }, [initUiPlugins])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-focus-mode', focusModeEnabled ? 'on' : 'off')
  }, [focusModeEnabled])

  const updateFocusMode = useCallback((enabled: boolean): void => {
    writeFocusModePreference(enabled)
    setFocusModeEnabled(enabled)
  }, [])

  const toggleTheme = useCallback((): void => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const next = isDark ? 'light' : 'dark'
    applyTheme(next)
    void rendererRuntimeClient.setSettings({ theme: next }).catch(() => undefined)
  }, [])

  return {
    focusModeEnabled,
    runtimeLogPath,
    toggleTheme,
    uiModeCameosEnabled,
    updateFocusMode
  }
}
