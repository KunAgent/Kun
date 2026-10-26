import { z } from 'zod'

/** Native mode IDs are opaque data, never commands. Validate before trimming controls. */
export const HarnessPermissionModePreferenceSchema = z.string()
  .refine(value => !/[\x00-\x1f\x7f-\x9f]/u.test(value), 'Permission mode must not contain control characters')
  .transform(value => value.trim())
  .pipe(z.string().max(64))
  .transform(value => value || undefined)
  .optional()
