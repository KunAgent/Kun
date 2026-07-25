import { useEffect, useState } from 'react'
import {
  DEFAULT_COMPOSER_SEND_KEY,
  normalizeComposerSendKey,
  type AppSettingsV1,
  type ComposerSendKey
} from '@shared/app-settings'
import { SETTINGS_CHANGED_EVENT } from './keyboard-shortcut-settings'

export function useComposerSendKeySetting(): ComposerSendKey {
  const [sendKey, setSendKey] = useState<ComposerSendKey>(DEFAULT_COMPOSER_SEND_KEY)

  useEffect(() => {
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) setSendKey(normalizeComposerSendKey(settings.composerSendKey))
    }

    if (typeof window.kunGui?.getSettings === 'function') {
      void window.kunGui.getSettings().then(apply).catch(() => undefined)
    }

    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return sendKey
}
