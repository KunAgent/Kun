/** Normalize separators without turning absolute roots into empty or drive-relative paths. */
export function normalizeWritePath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const stripped = normalized.replace(/\/+$/, '')
  if (!stripped && normalized.startsWith('/')) return '/'
  // Drive roots (including Win32 namespace paths) require the final separator.
  if (normalized.endsWith('/') && /^(?:[A-Za-z]:|\/\/[?.]\/[A-Za-z]:|\/\/\?\/Volume\{[^/{}]+\})$/.test(stripped)) {
    return `${stripped}/`
  }
  return stripped
}
