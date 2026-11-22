/** Recover a saved selection after the document changed. Older Word records
 * have no uniqueness evidence and require an exact match of both neighbors. */
export function relocatedQuoteOffset(
  text: string,
  quote: string,
  anchor: { unique?: boolean; before: string; after: string }
): number | null {
  const uniqueOffset = (pattern: string): number | null => {
    const first = text.indexOf(pattern)
    return first >= 0 && text.indexOf(pattern, first + 1) < 0 ? first : null
  }
  if (!anchor.unique) {
    const offset = uniqueOffset(anchor.before + quote + anchor.after)
    return offset === null ? null : offset + anchor.before.length
  }
  const exact = uniqueOffset(quote)
  if (exact !== null) return exact

  // The formerly unique quote now repeats. The available neighbors must
  // identify just one occurrence among them.
  const hits = new Set<number>()
  if (anchor.before) {
    const start = uniqueOffset(anchor.before + quote)
    if (start !== null) hits.add(start + anchor.before.length)
  }
  if (anchor.after) {
    const start = uniqueOffset(quote + anchor.after)
    if (start !== null) hits.add(start)
  }
  return hits.size === 1 ? [...hits][0] : null
}
