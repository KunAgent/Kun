import { z } from 'zod'

/**
 * Limits for user-configured provider custom HTTP headers. Enforced here
 * (server/registry) and mirrored in the renderer so a malformed map is
 * rejected before it ever reaches the request path or is persisted.
 */
export const CUSTOM_HEADER_MAX_COUNT = 64
export const CUSTOM_HEADER_NAME_MAX_LENGTH = 128
export const CUSTOM_HEADER_VALUE_MAX_BYTES = 8 * 1024
export const CUSTOM_HEADER_TOTAL_MAX_BYTES = 32 * 1024

/** RFC 7230 token characters (no separators, spaces, or control bytes). */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

/**
 * Hop-by-hop / transport-control headers must not be set as a custom header.
 * Content-Type and Authorization are intentionally allowed: a plain API-key
 * HTTP provider may legitimately override the default Bearer or content type.
 */
const FORBIDDEN_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'keep-alive',
  'te',
  'trailer'
])

/**
 * Returns a human-readable validation error for an invalid header map, or
 * `undefined` when the map is valid. An empty map is always valid.
 */
export function customHeaderValidationError(headers: Record<string, string>): string | undefined {
  const entries = Object.entries(headers)
  if (entries.length > CUSTOM_HEADER_MAX_COUNT) {
    return `custom headers must contain at most ${CUSTOM_HEADER_MAX_COUNT} entries`
  }
  const seen = new Set<string>()
  let totalBytes = 0
  for (const [name, value] of entries) {
    const trimmedName = name.trim()
    const lower = trimmedName.toLowerCase()
    if (!HTTP_TOKEN.test(trimmedName)) return `invalid header name: ${name}`
    if (trimmedName.length > CUSTOM_HEADER_NAME_MAX_LENGTH) {
      return `header name exceeds ${CUSTOM_HEADER_NAME_MAX_LENGTH} characters: ${name}`
    }
    if (FORBIDDEN_HEADER_NAMES.has(lower)) return `header name is not allowed: ${name}`
    if (seen.has(lower)) return `duplicate header name (case-insensitive): ${name}`
    seen.add(lower)
    if (/[\r\n\0]/u.test(value)) return `header value contains invalid control characters: ${name}`
    const bytes = new TextEncoder().encode(value).length
    if (bytes > CUSTOM_HEADER_VALUE_MAX_BYTES) {
      return `header value exceeds ${CUSTOM_HEADER_VALUE_MAX_BYTES} bytes: ${name}`
    }
    totalBytes += bytes
    if (totalBytes > CUSTOM_HEADER_TOTAL_MAX_BYTES) {
      return `custom headers exceed ${CUSTOM_HEADER_TOTAL_MAX_BYTES} bytes total`
    }
  }
  return undefined
}

/**
 * Zod schema for user-configured custom headers. Rejects invalid names, control
 * characters, case-insensitive duplicates, and oversized maps.
 */
export const CustomHeadersSchema = z.record(z.string(), z.string()).superRefine((headers, ctx) => {
  const error = customHeaderValidationError(headers)
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error })
})
