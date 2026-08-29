/**
 * Detects the `[[` reference the caret is currently inside.
 *
 * Deliberately line-scoped and unclosed-only: a completed `[[a]]` must not keep
 * the menu open when the caret drifts back into it, and a `[[` on an earlier
 * line is not an open reference for this one.
 */
export type WikilinkQuery = {
  /** Document offset just after the opening `[[`. */
  from: number
  /** Document offset at the caret; the query is the text between. */
  to: number
  query: string
  /** True when a `]]` already follows, so accepting must not add another. */
  closed: boolean
}

const MAX_QUERY_LENGTH = 200

export function findWikilinkQuery(text: string, cursor: number): WikilinkQuery | null {
  if (cursor < 2 || cursor > text.length) return null
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1
  const open = text.lastIndexOf('[[', cursor - 2 >= lineStart ? cursor : cursor)
  if (open < lineStart) return null
  const from = open + 2
  if (from > cursor) return null
  const query = text.slice(from, cursor)
  // A newline or a `]]` between the brackets and the caret means the caret is
  // no longer inside that reference.
  if (query.includes('\n') || query.includes(']]') || query.includes('[[')) return null
  if (query.length > MAX_QUERY_LENGTH) return null
  return {
    from,
    to: cursor,
    query,
    closed: text.startsWith(']]', cursor)
  }
}
