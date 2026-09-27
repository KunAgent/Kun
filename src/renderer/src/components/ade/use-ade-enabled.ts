import { useEffect, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { defaultKunAdeSettings } from '../../../../shared/app-settings-kun-harness'
import { getKunRuntimeSettings } from '../../../../shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'

// ADE 模式入口仅由 agents.kun.ade.enabled 控制;关闭时已有 ADE 线程保留
// 在服务端,只是不再出现在 Code/ADE 侧栏。
export function adeEnabledFromApp(settings: AppSettingsV1): boolean {
  return getKunRuntimeSettings(settings).ade.enabled
    ?? defaultKunAdeSettings().enabled
}

export function useAdeEnabled(): { enabled: boolean; loaded: boolean } {
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) {
        setEnabled(adeEnabledFromApp(settings))
        setLoaded(true)
      }
    }
    void rendererRuntimeClient.getSettings().then(apply).catch(() => undefined)
    const onSettingsChanged = (event: Event): void => {
      const settings = (event as CustomEvent<AppSettingsV1>).detail
      if (settings) apply(settings)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return { enabled, loaded }
}
