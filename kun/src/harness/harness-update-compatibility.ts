import type { HarnessTestResponse } from '../contracts/harness-test.js'

/** Software compatibility does not grant account readiness or turn admission. */
export function harnessUpdateCompatible(result: HarnessTestResponse): boolean {
  if (result.ok) return true
  const failures = result.readiness?.checks.filter((check) => !check.ok)
  return result.detect.ok && result.handshake?.ok === true && !result.readiness?.detail &&
    Boolean(failures?.length && failures.every((check) => check.id === 'credentials'))
}
