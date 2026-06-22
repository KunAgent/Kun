import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'
import { IKUN_MODE_STORAGE_KEY } from './ikun-mode'

/**
 * 形象模式偏好:'default' | 'ikun' | 'retroma' | <UI 插件 id>。
 * 取代旧的布尔型 kun.ikunMode(读取时自动迁移)。
 */
export const UI_MODE_STORAGE_KEY = 'kun.uiMode'

export const UI_MODE_DEFAULT = 'default'
export const UI_MODE_IKUN = 'ikun'
/** Retroma 羊皮纸浅色配色模式:纯配色(无吉祥物),仅浅色生效 */
export const UI_MODE_RETROMA = 'retroma'

const UI_MODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/

export function readUiModePreference(): string {
  const stored = readBrowserStorageItem(UI_MODE_STORAGE_KEY)?.trim().toLowerCase()
  if (stored && (stored === UI_MODE_DEFAULT || UI_MODE_PATTERN.test(stored))) {
    return stored
  }
  // 迁移:旧的 iKun 开关
  const legacy = readBrowserStorageItem(IKUN_MODE_STORAGE_KEY)?.trim().toLowerCase()
  if (legacy === '1' || legacy === 'true' || legacy === 'on') {
    return UI_MODE_IKUN
  }
  return UI_MODE_DEFAULT
}

export function writeUiModePreference(mode: string): void {
  writeBrowserStorageItem(UI_MODE_STORAGE_KEY, mode)
  // 同步旧键,兼容尚未迁移的读取方
  writeBrowserStorageItem(IKUN_MODE_STORAGE_KEY, mode === UI_MODE_IKUN ? '1' : '0')
}
