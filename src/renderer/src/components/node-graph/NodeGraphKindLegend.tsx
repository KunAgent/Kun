import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  NODE_GRAPH_NODE_KINDS,
  type NodeGraphNodeKind,
  type NodeGraphProjection
} from '../../node-graph/node-graph-types'
import {
  NODE_GRAPH_KIND_COLORS,
  NODE_GRAPH_KIND_LABEL_KEYS,
  NODE_GRAPH_KIND_SHAPES
} from './node-graph-theme'
import { nodeGraphShapePath } from './node-graph-shapes'
import { KUN_NODE_ICON_SOURCES } from './node-graph-kun-icons'
import { isKunStyledNodeKind, useKunNodeStyle } from '../../node-graph/kun-node-style'

type Props = {
  counts: NodeGraphProjection['counts']
  kinds: Record<NodeGraphNodeKind, boolean>
  onToggleKind: (kind: NodeGraphNodeKind) => void
}

/**
 * Whatever the canvas is painting for this kind, at glyph size.
 *
 * Every list that names a node — the legend, the insights rankings, the
 * inspector's connections — renders this, so following the canvas here is what
 * keeps a row recognisable as the thing on screen. It reads the Kun-style state
 * itself rather than taking a prop: it is a leaf in three separate trees, and
 * threading a global shell setting through all of them buys nothing.
 */
export function NodeGraphKindGlyph({
  kind,
  size = 16,
  muted = false
}: {
  kind: NodeGraphNodeKind
  size?: number
  muted?: boolean
}): ReactElement {
  const kunStyle = useKunNodeStyle()
  if (kunStyle && isKunStyledNodeKind(kind)) {
    return (
      <img
        src={KUN_NODE_ICON_SOURCES[kind]}
        alt=""
        aria-hidden
        draggable={false}
        width={size}
        height={size}
        className="block shrink-0 object-contain"
        style={muted ? { opacity: 0.25 } : undefined}
      />
    )
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden focusable="false">
      <path
        d={nodeGraphShapePath(NODE_GRAPH_KIND_SHAPES[kind], size)}
        fill={NODE_GRAPH_KIND_COLORS[kind]}
        opacity={muted ? 0.25 : 1}
      />
    </svg>
  )
}

/**
 * Legend and kind filter in one control.
 *
 * The canvas encodes kind as both a colour and a shape, which is unreadable
 * without a key — and a key that is only a key wastes the space it occupies, so
 * each entry is also the toggle for that kind. A kind with no nodes stays
 * visible and dimmed rather than disappearing, because its absence is itself
 * information ("no memories yet") and a legend that reflows as data arrives is
 * hard to learn.
 */
export function NodeGraphKindLegend({ counts, kinds, onToggleKind }: Props): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-control border border-ds-border-muted bg-ds-main/60 p-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint">
          {t('nodeGraphKinds')}
        </span>
        <span className="text-[10.5px] text-ds-faint">{t('nodeGraphKindsHint')}</span>
      </div>
      <ul className="grid grid-cols-5 gap-0.5">
        {NODE_GRAPH_NODE_KINDS.map((kind) => {
          const count = counts[kind] ?? 0
          const enabled = kinds[kind] !== false
          const label = t(NODE_GRAPH_KIND_LABEL_KEYS[kind])
          return (
            <li key={kind}>
              <button
                type="button"
                onClick={() => onToggleKind(kind)}
                aria-pressed={enabled}
                title={`${label} · ${count}`}
                className={`flex w-full flex-col items-center gap-0.5 rounded-control px-0.5 py-1 transition-colors hover:bg-ds-hover ${
                  enabled ? '' : 'opacity-45'
                }`}
              >
                <NodeGraphKindGlyph kind={kind} muted={!enabled} />
                <span className="w-full truncate text-center text-[9.5px] leading-tight text-ds-muted">
                  {label}
                </span>
                <span className="text-[9.5px] tabular-nums leading-none text-ds-faint">
                  {count}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
