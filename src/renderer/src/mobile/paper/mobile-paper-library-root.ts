const STORAGE_KEY = 'kun.mobile.paper.library'

/** A phone-only preference; never writes desktop `write.paperMode.enabled` or activeLibrary. */
export function mobilePaperLibraryRoot(libraries: readonly string[], active: string, fallback: string): string {
  let preferred = ''
  try { preferred = window.sessionStorage.getItem(STORAGE_KEY) ?? '' } catch { /* private mode */ }
  if (preferred && libraries.includes(preferred)) return preferred
  return active || libraries[0] || fallback
}

export function setMobilePaperLibraryRoot(root: string, libraries: readonly string[]): void {
  if (!libraries.includes(root)) return
  try { window.sessionStorage.setItem(STORAGE_KEY, root) } catch { /* private mode */ }
}
