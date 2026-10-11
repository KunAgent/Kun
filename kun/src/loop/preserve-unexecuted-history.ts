import type { TurnItem } from '../contracts/items.js'

/** Preserve excluded canonical inputs without letting compaction squash them. */
export function restoreUnexecutedHistory(
  original: readonly TurnItem[],
  executable: readonly TurnItem[],
  compacted: TurnItem[]
): TurnItem[] {
  const executableIds = new Set(executable.map((item) => item.id))
  if (original.every((item) => executableIds.has(item.id))) return compacted
  const survivingIds = new Set(compacted.map((item) => item.id))
  const before = new Map<string | undefined, TurnItem[]>()
  let anchor: string | undefined
  // Retain each excluded group beside its next surviving canonical neighbor.
  // Summary/context replacements may remove an old anchor; never move or sort
  // the compacted records themselves to accommodate the preserved input.
  for (let index = original.length - 1; index >= 0; index -= 1) {
    const item = original[index]!
    if (executableIds.has(item.id)) {
      if (survivingIds.has(item.id)) anchor = item.id
    } else {
      const group = before.get(anchor) ?? []
      group.push(item)
      before.set(anchor, group)
    }
  }
  return [
    ...compacted.flatMap((item) => [...(before.get(item.id) ?? []).reverse(), item]),
    ...(before.get(undefined) ?? []).reverse()
  ]
}
