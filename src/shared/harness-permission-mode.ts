import { HarnessPermissionModePreferenceSchema } from '../../kun/src/contracts/harness-permission-preference.js'

/** GUI validation and settings normalization share the runtime's native-mode contract. */
export function normalizeHarnessPermissionMode(value: unknown): string | undefined {
  return HarnessPermissionModePreferenceSchema.parse(value)
}
