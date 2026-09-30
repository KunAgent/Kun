import { useEffect, useState } from 'react'
import type { KunRuntimeSettingsSyncStatusPayload } from '@shared/kun-gui-api'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { coerceRendererSettings } from './settings-utils'

/**
 * Live view of the main process's runtime settings sync status. When the
 * local-gateway credential migration persisted a settings repair
 * (gateway_disabled), refresh the settings form so the toggle does not show
 * a stale enabled state.
 */
export function useRuntimeSettingsSyncStatus(active: boolean): KunRuntimeSettingsSyncStatusPayload | null {
  const [status, setStatus] = useState<KunRuntimeSettingsSyncStatusPayload | null>(null)
  useEffect(() => {
    if (!active) return
    let mounted = true
    const handleStatus = (next: KunRuntimeSettingsSyncStatusPayload): void => {
      if (!mounted) return
      setStatus((current) => (current && current.generation > next.generation ? current : next))
      if (next.sections?.localModelGateway?.code === 'gateway_disabled') {
        void rendererRuntimeClient.getSettings({ forceRefresh: true })
          .then((s) => { if (mounted) emitRendererSettingsChanged(coerceRendererSettings(s)) })
          .catch(() => undefined)
      }
    }
    if (typeof window.kunGui?.getRuntimeSettingsSyncStatus === 'function') {
      void window.kunGui.getRuntimeSettingsSyncStatus().then(handleStatus).catch(() => undefined)
    }
    const unsubscribe = typeof window.kunGui?.onRuntimeSettingsSyncStatus === 'function'
      ? window.kunGui.onRuntimeSettingsSyncStatus(handleStatus)
      : undefined
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [active])
  return status
}
