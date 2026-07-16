import type { AppSettingsV1 } from '../app-settings.js'
import { EXTENSION_ENDPOINT_TEMPLATES } from './endpoints.js'

// EXT-SEAM: Extension settings merger
export function mergeExtensionSettings(base: AppSettingsV1): AppSettingsV1 {
  // Stage 0: no-op (Stage 1+ will merge experts/design settings)
  return base
}

// EXT-SEAM: Extension endpoint allowlist templates (experts/moa/automation/design/collaboration)
export { EXTENSION_ENDPOINT_TEMPLATES } from './endpoints.js'
export const extensionEndpoints = EXTENSION_ENDPOINT_TEMPLATES
