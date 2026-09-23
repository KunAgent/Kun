/**
 * Block-level alignment for the rich diff review (implementation §6.2).
 *
 * Callers parse both revisions with `parseWorkDocument` and pass the per-block
 * verbatim keys (`raw.trimEnd()`). `diffArrays` finds equal/removed/added
 * runs; a "removed k + added m" run at the same position is then paired in
 * order, and pairs whose character similarity (`diffChars` common part,
 * Dice coefficient) reaches 0.5 become `modified` chunks. The rest stay
 * `removed`/`added`.
 */
import { diffArrays, diffChars } from 'diff'

export type ReviewChunk =
  | { kind: 'added'; next: number[] }
  | { kind: 'removed'; prev: number[]; anchorNext: number }
  | { kind: 'modified'; prev: number; next: number }

const MODIFIED_SIMILARITY = 0.5

function similarity(a: string, b: string): number {
  if (a === b) return 1
  const total = a.length + b.length
  if (total === 0) return 1
  let common = 0
  for (const part of diffChars(a, b)) {
    if (!part.added && !part.removed) common += part.count ?? part.value.length
  }
  return (2 * common) / total
}

/**
 * Align two block-key sequences. `next`/`prev` are indexes into the passed
 * arrays; `anchorNext` on a `removed` chunk is the `next` index before which
 * the deleted blocks disappeared (=== next.length for a tail deletion).
 */
export function alignBlocks(prev: string[], next: string[]): ReviewChunk[] {
  const chunks: ReviewChunk[] = []
  let prevIndex = 0
  let nextIndex = 0
  let pendingRemoved: number[] = []

  const flushRemoved = () => {
    if (pendingRemoved.length) {
      chunks.push({ kind: 'removed', prev: pendingRemoved, anchorNext: nextIndex })
    }
    pendingRemoved = []
  }

  for (const part of diffArrays(prev, next)) {
    const count = part.count ?? 0
    if (part.removed) {
      for (let i = 0; i < count; i++) pendingRemoved.push(prevIndex++)
      continue
    }
    if (part.added) {
      const removed = pendingRemoved
      pendingRemoved = []
      const added: number[] = []
      for (let i = 0; i < count; i++) added.push(nextIndex++)

      const restRemoved: number[] = []
      const restAdded: number[] = []
      const pairs = Math.min(removed.length, added.length)
      for (let i = 0; i < pairs; i++) {
        if (similarity(prev[removed[i]], next[added[i]]) >= MODIFIED_SIMILARITY) {
          chunks.push({ kind: 'modified', prev: removed[i], next: added[i] })
        } else {
          restRemoved.push(removed[i])
          restAdded.push(added[i])
        }
      }
      restRemoved.push(...removed.slice(pairs))
      restAdded.push(...added.slice(pairs))
      if (restRemoved.length) {
        chunks.push({
          kind: 'removed',
          prev: restRemoved,
          anchorNext: restAdded[0] ?? nextIndex
        })
      }
      if (restAdded.length) chunks.push({ kind: 'added', next: restAdded })
      continue
    }
    flushRemoved()
    prevIndex += count
    nextIndex += count
  }
  flushRemoved()
  return chunks
}
