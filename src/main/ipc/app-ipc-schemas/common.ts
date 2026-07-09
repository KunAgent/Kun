import { z } from 'zod'
export const MAX_BODY_BYTES = 2_000_000
export const MAX_PATH_LENGTH = 4_096
export const MAX_URL_LENGTH = 4_096
export const MAX_ID_LENGTH = 256
// Provider catalogs can expose routed model ids longer than local object ids.
export const MAX_MODEL_ID_LENGTH = 512
export const MAX_BRANCH_LENGTH = 255
export const MAX_EDITOR_ID_LENGTH = 64
export const MAX_NOTIFICATION_TITLE_LENGTH = 200
export const MAX_NOTIFICATION_BODY_LENGTH = 5_000
export const MAX_CHANNEL_TEXT_LENGTH = 100_000
export const MAX_SKILL_FILE_BYTES = 1_000_000
export const MAX_CONFIG_FILE_BYTES = 2_000_000
export const MAX_DEVICE_CODE_LENGTH = 8_192
export const MAX_EDITOR_COMPLETION_TEXT = 200_000
export const MAX_SAVE_FILE_BASE64_BYTES = 64 * 1024 * 1024

const SAFE_OPEN_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function trimmedString(max: number): z.ZodString {
  return z.string().trim().min(1).max(max)
}

export function optionalTrimmedString(max: number): z.ZodOptional<z.ZodString> {
  return z.string().trim().max(max).optional()
}

export function isSafeOpenExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return SAFE_OPEN_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

export const defaultPathSchema = optionalTrimmedString(MAX_PATH_LENGTH)

export const confirmDialogPayloadSchema = z
  .object({
    message: trimmedString(4_000),
    detail: z.string().max(8_000).optional(),
    confirmLabel: z.string().trim().max(200).optional(),
    cancelLabel: z.string().trim().max(200).optional()
  })
  .strict()

export const legacySessionImportPayloadSchema = z
  .object({
    sourceDir: defaultPathSchema
  })
  .strict()
