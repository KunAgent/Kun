import { useEffect } from 'react'
import type { SettingsRouteSection } from '../store/chat-store'
import { settingsCategoryForRouteSection } from './settings-navigation'

/**
 * Opens the page a deep link names and marks it as just arrived, so the page
 * can briefly highlight what the person came for.
 */
export function useSettingsRouteSynchronization(scope: Record<string, any>): void {
  const { settingsSection, setCategory, markArrival } = scope as Record<string, any> & {
    settingsSection: SettingsRouteSection | null
    markArrival?: () => void
  }
  useEffect(() => {
    setCategory(settingsCategoryForRouteSection(settingsSection))
    if (settingsSection && settingsSection !== 'general') markArrival?.()
  }, [settingsSection])
}
