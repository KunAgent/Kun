import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Canonical default Kun runtime data root. `kun serve`, the desktop runtime,
 * and the `kun extension` CLI all derive their per-profile state from this
 * directory, so the literal lives in one place instead of being re-derived by
 * every entry point.
 */
export function defaultKunDataDir(homeDir: string = homedir()): string {
  return join(homeDir, '.kun', 'data')
}
