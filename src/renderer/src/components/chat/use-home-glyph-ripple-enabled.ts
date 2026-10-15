import { useEffect, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'

export function homeGlyphRippleEnabledFromSettings(settings: Pick<AppSettingsV1, 'homeGlyphRipple'>): boolean {
  return settings.homeGlyphRipple !== false
}

/**
 * Appearance → 主页点击涟漪. `null` until the first settings read lands, so a
 * user who turned the field off never sees it flash in on launch.
 */
export function useHomeGlyphRippleEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    let changed = false
    const apply = (settings: AppSettingsV1 | undefined): void => {
      if (!cancelled && settings) setEnabled(homeGlyphRippleEnabledFromSettings(settings))
    }
    if (typeof window.kunGui?.getSettings === 'function') {
      void window.kunGui.getSettings().then((settings) => {
        if (!changed) apply(settings)
      }).catch(() => {
        if (!cancelled && !changed) setEnabled(true)
      })
    } else {
      setEnabled(true)
    }
    const onSettingsChanged = (event: Event): void => {
      changed = true
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return enabled
}
