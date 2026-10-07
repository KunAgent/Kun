import { z } from 'zod'

/** Sanitized snapshot of one harness session config option (ACP §7.3). */
export const HarnessConfigOptionSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().max(256).optional(),
    category: z.string().max(64).optional(),
    currentValue: z.union([z.string().max(1_024), z.boolean()]).optional(),
    values: z.array(z.string().max(1_024)).max(128).optional()
  })
  .strict()

const SettingIdSchema = z.string().min(1).max(256)
const SettingLabelSchema = z.string().max(256)

/**
 * A session control an Agent publishes that Kun does not model itself
 * (docs/ade/17 §4.4), e.g. an ACP config option outside model, mode and
 * reasoning. The composer renders these generically; a turn carries the
 * chosen values back by id.
 */
export const HarnessSessionSettingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('select'),
    id: SettingIdSchema,
    label: SettingLabelSchema,
    value: z.string().max(1_024),
    options: z.array(z.object({
      value: z.string().max(1_024),
      label: SettingLabelSchema
    }).strict()).max(128)
  }).strict(),
  z.object({
    kind: z.literal('toggle'),
    id: SettingIdSchema,
    label: SettingLabelSchema,
    value: z.boolean()
  }).strict()
])
export type HarnessSessionSetting = z.infer<typeof HarnessSessionSettingSchema>

export const MAX_HARNESS_SESSION_SETTINGS = 16
export const HarnessSessionSettingListSchema = z.array(HarnessSessionSettingSchema).max(MAX_HARNESS_SESSION_SETTINGS)

/** Values a turn asks the Agent to use, keyed by setting id. */
export const HarnessSettingValuesSchema = z
  .record(SettingIdSchema, z.union([z.string().max(1_024), z.boolean()]))
  .refine((values) => Object.keys(values).length <= MAX_HARNESS_SESSION_SETTINGS, 'too many Agent settings')
export type HarnessSettingValues = z.infer<typeof HarnessSettingValuesSchema>
