import { useMemo, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type {
  PaperLibraryEntry,
  PaperReferenceItem
} from '@shared/paper/paper-library-types'
import {
  layoutCitationGraph,
  pickCitationGraphNeighbors
} from '../../../paper/paper-citation-graph'
import { openLibraryEntry } from '../../../paper/paper-library-actions'

const BOX_W = 236
const BOX_H = 150
const CX = BOX_W / 2
const CY = BOX_H / 2
const NODE_R = 5

/**
 * R3.3 citation-neighbor graph (shared with discover D5.2): the current paper
 * centered, its references on a ring. Solid accent = already in the library
 * (click opens it); outline = resolvable (click opens DOI/arXiv externally).
 */
export function PaperCitationGraph({
  centerTitle,
  items,
  entries,
  t
}: {
  centerTitle: string
  items: readonly PaperReferenceItem[]
  entries: readonly PaperLibraryEntry[]
  t: TFunction
}): ReactElement | null {
  const neighbors = useMemo(() => pickCitationGraphNeighbors(items, entries), [items, entries])
  const layout = useMemo(() => layoutCitationGraph(neighbors), [neighbors])
  if (layout.length === 0) return null

  const openNeighbor = (neighbor: (typeof layout)[number]['neighbor']): void => {
    if (neighbor.inLibrary) {
      void openLibraryEntry(neighbor.inLibrary)
      return
    }
    const url = neighbor.ref.doi
      ? `https://doi.org/${neighbor.ref.doi}`
      : neighbor.ref.arxivId
        ? `https://arxiv.org/abs/${neighbor.ref.arxivId}`
        : ''
    if (url) void window.kunGui?.openExternal?.(url)?.catch(() => undefined)
  }

  return (
    <div className="mt-2 rounded-lg border border-ds-border-muted p-1.5">
      <p className="px-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-ds-faint">
        {t('writePaperReaderCitationGraph')}
      </p>
      <svg
        viewBox={`0 0 ${BOX_W} ${BOX_H}`}
        className="block w-full"
        role="img"
        aria-label={t('writePaperReaderCitationGraph')}
      >
        {layout.map((node) => (
          <line
            key={`e-${node.neighbor.key}`}
            x1={CX}
            y1={CY}
            x2={node.x * BOX_W}
            y2={node.y * BOX_H}
            className="stroke-ds-border-muted"
            strokeWidth={node.neighbor.inLibrary ? 1 : 0.6}
            strokeDasharray={node.neighbor.inLibrary ? undefined : '2 3'}
          />
        ))}
        {layout.map((node) => {
          const x = node.x * BOX_W
          const y = node.y * BOX_H
          const label = node.neighbor.ref.title ?? node.neighbor.ref.raw ?? `[${node.neighbor.ref.n}]`
          const interactive = Boolean(
            node.neighbor.inLibrary || node.neighbor.ref.doi || node.neighbor.ref.arxivId
          )
          return (
            <g
              key={node.neighbor.key}
              transform={`translate(${x} ${y})`}
              className={interactive ? 'cursor-pointer' : undefined}
              onClick={interactive ? () => openNeighbor(node.neighbor) : undefined}
            >
              <title>
                {node.neighbor.inLibrary
                  ? `${label} · ${t('writePaperRefInLibrary')}`
                  : label}
              </title>
              <circle
                r={NODE_R}
                className={
                  node.neighbor.inLibrary
                    ? 'fill-accent'
                    : interactive
                      ? 'fill-ds-card stroke-accent'
                      : 'fill-ds-card stroke-ds-border'
                }
                strokeWidth={1.4}
              />
              <text
                y={node.y < 0.5 ? -NODE_R - 3 : NODE_R + 9}
                textAnchor="middle"
                className={`select-none fill-ds-faint ${interactive ? 'hover:fill-accent' : ''}`}
                style={{ fontSize: 8.5 }}
              >
                [{node.neighbor.ref.n}]
              </text>
            </g>
          )
        })}
        <g transform={`translate(${CX} ${CY})`}>
          <title>{centerTitle}</title>
          <circle r={7} className="fill-accent" />
          <text
            y={20}
            textAnchor="middle"
            className="fill-ds-ink"
            style={{ fontSize: 9, fontWeight: 600 }}
          >
            {centerTitle.length > 34 ? `${centerTitle.slice(0, 34)}…` : centerTitle}
          </text>
        </g>
      </svg>
    </div>
  )
}
