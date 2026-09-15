/**
 * Opaque offset cursors shared by the context-window history and notes
 * queries. Same shape as the builtin source-tool cursors: a base64url JSON
 * envelope binding the cursor to its query string so a cursor cannot be
 * replayed against a different listing.
 */
export type OffsetCursor = { q: string; i: number }

export function encodeOffsetCursor(query: string, offset: number): string {
  return Buffer.from(JSON.stringify({ q: query, i: offset } satisfies OffsetCursor), 'utf8')
    .toString('base64url')
}

/** Returns the offset, 0 for an absent cursor, or an Error for a foreign cursor. */
export function decodeOffsetCursor(value: string | undefined, expectedQuery: string): number | Error {
  if (value === undefined || value === '') return 0
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as OffsetCursor
    if (parsed.q !== expectedQuery || !Number.isSafeInteger(parsed.i) || parsed.i < 0) {
      return new Error('cursor does not belong to this query')
    }
    return parsed.i
  } catch {
    return new Error('cursor is invalid')
  }
}
