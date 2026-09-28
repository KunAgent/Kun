import type { HarnessesConfig, HarnessDefaultsEntry } from '../config/kun-config-application.js'
import type { HarnessId } from '../contracts/harness.js'

/**
 * Per-harness default resolution (docs/ade/impl/p4 §3.6, P4-11).
 * `defaults[harnessId]` is the canonical shape; the legacy flat
 * `defaultPermissionMode[harnessId]` still applies when the new entry
 * does not carry a permissionMode of its own.
 */
export function harnessDefaultsFor(
  harnesses: HarnessesConfig | undefined,
  harnessId: HarnessId | string
): HarnessDefaultsEntry | undefined {
  const entry = harnesses?.defaults?.[harnessId as HarnessId]
  const legacy = harnesses?.defaultPermissionMode?.[harnessId as HarnessId]
  if (!entry) return legacy ? { permissionMode: legacy } : undefined
  return entry.permissionMode || !legacy ? entry : { ...entry, permissionMode: legacy }
}
