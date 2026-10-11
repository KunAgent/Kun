const STORAGE_KEY = 'kun.mobile.paper.library'

/** A phone-only preference; never writes desktop `write.paperMode.enabled` or activeLibrary. */
export function mobilePaperLibraryRoot(libraries: readonly string[], active: string): string {
  let preferred = ''
  try { preferred = window.sessionStorage.getItem(STORAGE_KEY) ?? '' } catch { /* private mode */ }
  if (preferred.trim() && libraries.includes(preferred)) return preferred
  if (active.trim() && libraries.includes(active)) return active
  return libraries.find((library) => Boolean(library.trim())) ?? ''
}

export function setMobilePaperLibraryRoot(root: string, libraries: readonly string[]): void {
  if (!root.trim() || !libraries.includes(root)) return
  try { window.sessionStorage.setItem(STORAGE_KEY, root) } catch { /* private mode */ }
}
