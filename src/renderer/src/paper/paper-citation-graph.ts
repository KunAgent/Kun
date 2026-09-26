/**
 * R3.3 citation-neighbor graph layout (shared with discover D5.2): the current
 * paper sits at the center; neighbors are placed on an ellipse ring, ordered
 * so resolvable (doi/arxivId) and in-library items come first.
 */
import type { PaperLibraryEntry, PaperReferenceItem } from '@shared/paper/paper-library-types'

export type CitationGraphNeighbor = {
  key: string
  ref: PaperReferenceItem
  inLibrary: PaperLibraryEntry | null
}

export type CitationGraphLayoutNode = {
  neighbor: CitationGraphNeighbor
  /** Normalized position 0..1 relative to the graph box. */
  x: number
  y: number
  angle: number
}

/** Max neighbors rendered — beyond this the ring gets unreadably dense. */
export const CITATION_GRAPH_MAX_NODES = 16

/** Pick the neighbors to render: resolvable + in-library first, then by order. */
export function pickCitationGraphNeighbors(
  items: readonly PaperReferenceItem[],
  entries: readonly PaperLibraryEntry[],
  max = CITATION_GRAPH_MAX_NODES
): CitationGraphNeighbor[] {
  const inLibraryFor = (ref: PaperReferenceItem): PaperLibraryEntry | null =>
    entries.find((entry) =>
      (ref.arxivId && entry.meta.arxivId === ref.arxivId)
      || (ref.doi && entry.meta.doi?.toLowerCase() === ref.doi.toLowerCase())
    ) ?? null
  const scored = items.map((ref, index) => ({
    neighbor: {
      key: ref.doi ?? ref.arxivId ?? `n${ref.n}`,
      ref,
      inLibrary: inLibraryFor(ref)
    },
    index,
    resolvable: Boolean(ref.doi || ref.arxivId)
  }))
  scored.sort((a, b) =>
    Number(b.neighbor.inLibrary !== null) - Number(a.neighbor.inLibrary !== null)
    || Number(b.resolvable) - Number(a.resolvable)
    || a.index - b.index
  )
  return scored.slice(0, max).map((item) => item.neighbor)
}

/**
 * Radial positions: neighbors on an ellipse (rx ≈ 0.42, ry ≈ 0.36), starting
 * at the top and evenly spaced. The first neighbor is placed at the top and
 * the rest alternate left/right so dense labels fan out symmetrically.
 */
export function layoutCitationGraph(
  neighbors: readonly CitationGraphNeighbor[]
): CitationGraphLayoutNode[] {
  const count = neighbors.length
  if (count === 0) return []
  return neighbors.map((neighbor, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
    return {
      neighbor,
      x: 0.5 + 0.42 * Math.cos(angle),
      y: 0.5 + 0.36 * Math.sin(angle),
      angle
    }
  })
}
