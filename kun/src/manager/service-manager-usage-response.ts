import { jsonResponse, type JsonResponse } from '../server/response.js'
import {
  UsageIndexUnavailableError,
  type UsageIndexErrorCode
} from './usage-errors.js'

/**
 * The SQLite usage index is a rebuildable projection over the canonical JSONL
 * history. When it is unavailable (missing/broken database, in-progress
 * backfill, or query timeout), report a typed 503 instead of a generic
 * internal_error so callers can degrade to the JSONL fallback.
 *
 * Producers signal this state in two ways: typed `UsageIndexUnavailableError`s
 * carry the code on `error.code` while plain `Error`s embed it in the message,
 * so both shapes must be recognized here.
 */
export function isUsageIndexUnavailable(error: unknown): boolean {
  return usageIndexErrorCode(error) !== undefined
}

export function usageIndexUnavailableResponse(error: unknown): JsonResponse {
  const code = usageIndexErrorCode(error) ?? 'usage_index_unavailable'
  return jsonResponse({
    code,
    message: code === 'usage_query_timeout'
      ? 'Usage index query timed out.'
      : 'Usage index is temporarily unavailable.'
  }, 503)
}

function usageIndexErrorCode(error: unknown): UsageIndexErrorCode | undefined {
  const declared = error instanceof UsageIndexUnavailableError
    ? error.code
    : (error as { code?: unknown } | null | undefined)?.code
  if (declared === 'usage_index_unavailable' || declared === 'usage_query_timeout') {
    return declared
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('usage_query_timeout')) return 'usage_query_timeout'
  if (message.includes('usage_index_unavailable')) return 'usage_index_unavailable'
  return undefined
}
