/** Combine independently fetched detail/item snapshots without skipping either one's replay gap. */
export function mergeRoomRunCursors(runId: string, ...values: Array<string | undefined>): string {
  const present = values.filter((value): value is string => Boolean(value))
  try {
    const parsed = present.map((value) => JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))))
    if (!parsed.length || parsed.some((value) => value.v !== 1 || value.id !== runId ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.seq) || value.seq < 0)) {
      return present[0] ?? ''
    }
    return btoa(JSON.stringify({ ...parsed[0],
      revision: Math.min(...parsed.map((value) => value.revision)),
      seq: Math.min(...parsed.map((value) => value.seq))
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch { return present[0] ?? '' }
}
