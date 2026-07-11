import { browserStorage, type BrowserStorageLike } from '../lib/browser-storage'

const WRITE_EDITOR_DISPLAY_STORAGE_KEY = 'kun.write.editor-display.v1'

export type WriteEditorDisplayPreferences = {
  lineNumbers: boolean
  lineWrapping: boolean
}

export const DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES: WriteEditorDisplayPreferences = {
  lineNumbers: false,
  lineWrapping: true
}

export function readWriteEditorDisplayPreferences(
  storage: BrowserStorageLike | null = browserStorage()
): WriteEditorDisplayPreferences {
  try {
    const parsed = JSON.parse(storage?.getItem(WRITE_EDITOR_DISPLAY_STORAGE_KEY) ?? '') as Partial<WriteEditorDisplayPreferences>
    return {
      lineNumbers: parsed.lineNumbers === true,
      lineWrapping: parsed.lineWrapping !== false
    }
  } catch {
    return { ...DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES }
  }
}

export function writeWriteEditorDisplayPreferences(
  preferences: WriteEditorDisplayPreferences,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  try {
    storage?.setItem(WRITE_EDITOR_DISPLAY_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Display preferences are optional; an unavailable storage backend must not block editing.
  }
}
