import { nativeTheme } from 'electron'
import type { AppSettingsV1 } from '../shared/app-settings'

/**
 * The macOS sidebar is painted translucent over the window's native vibrancy
 * material, which follows nativeTheme rather than the renderer's data-theme.
 * Pin it to the app theme so a dark Kun window never sits on light glass when
 * the system appearance is light (and the reverse).
 */
export function syncNativeThemeSource(
  theme: AppSettingsV1['theme'],
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'darwin') return
  const source = theme === 'dark' || theme === 'light' ? theme : 'system'
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source
}
