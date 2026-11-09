/**
 * Merge child-process environments without mutating any source. On Windows,
 * variable names are case-insensitive; the last source's spelling and value
 * win. Keep explicit undefined values so Node omits them rather than reviving
 * an inherited value (including PATH/PATHEXT).
 */
export function mergeProcessEnvironments(
  platform: NodeJS.Platform,
  ...sources: NodeJS.ProcessEnv[]
): NodeJS.ProcessEnv {
  const entries = new Map<string, [string, string | undefined]>()
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      entries.set(platform === 'win32' ? key.toLowerCase() : key, [key, value])
    }
  }
  return Object.fromEntries(entries.values())
}
