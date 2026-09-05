import { jsonResponse, type JsonResponse } from '../server/response.js'

/**
 * The SQLite usage index is a rebuildable projection over the canonical JSONL
 * history. When it is unavailable (missing/broken database, in-progress
 * backfill, or query timeout), report a typed 503 instead of a generic
 * internal_error so callers can degrade to the JSONL fallback.
 */
export function isUsageIndexUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('usage_index_unavailable') || message.includes('usage_query_timeout')
}

export function usageIndexUnavailableResponse(error: unknown): JsonResponse {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.includes('usage_query_timeout')
    ? 'usage_query_timeout'
    : 'usage_index_unavailable'
  return jsonResponse({
    code,
    message: code === 'usage_query_timeout'
      ? 'Usage index query timed out.'
      : 'Usage index is temporarily unavailable.'
  }, 503)
}
