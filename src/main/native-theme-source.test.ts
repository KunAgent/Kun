import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeTheme = vi.hoisted(() => ({ themeSource: 'system' as 'system' | 'light' | 'dark' }))
vi.mock('electron', () => ({ nativeTheme }))

import { syncNativeThemeSource } from './native-theme-source'

describe('syncNativeThemeSource', () => {
  beforeEach(() => {
    nativeTheme.themeSource = 'system'
  })

  it('pins the native material to an explicit app theme on macOS', () => {
    syncNativeThemeSource('dark', 'darwin')
    expect(nativeTheme.themeSource).toBe('dark')
    syncNativeThemeSource('light', 'darwin')
    expect(nativeTheme.themeSource).toBe('light')
  })

  it('returns to the system appearance when the app follows the system', () => {
    nativeTheme.themeSource = 'dark'
    syncNativeThemeSource('system', 'darwin')
    expect(nativeTheme.themeSource).toBe('system')
  })

  it('leaves other platforms alone', () => {
    syncNativeThemeSource('dark', 'win32')
    expect(nativeTheme.themeSource).toBe('system')
  })
})
