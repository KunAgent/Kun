import type { ReactElement } from 'react'

/**
 * Stat tiles for the Insights tab.
 *
 * Each number carries a small mark — a sparkline or a ring — so the tile reads
 * at a glance and not only after the digits are parsed. The marks are inline SVG
 * and derived from real values; none of them are decorative.
 */

export function NodeGraphStatCard({
  label,
  value,
  unit,
  note,
  mark
}: {
  label: string
  value: string
  unit?: string
  note?: string
  mark?: ReactElement
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-control border border-ds-border-muted bg-ds-main/60 px-2.5 py-2">
      <span className="truncate text-[10px] uppercase tracking-wide text-ds-faint">{label}</span>
      <span className="flex items-end justify-between gap-2">
        <span className="flex items-baseline gap-1">
          <span className="text-[19px] font-semibold leading-none tabular-nums text-ds-ink">
            {value}
          </span>
          {unit ? <span className="text-[11px] text-ds-muted">{unit}</span> : null}
        </span>
        {mark ? <span className="shrink-0">{mark}</span> : null}
      </span>
      {note ? <span className="truncate text-[10.5px] text-ds-faint">{note}</span> : null}
    </div>
  )
}

/**
 * Proportion ring. Reads as "how much of the graph is this" without needing the
 * percentage to be parsed first.
 */
export function NodeGraphRing({
  ratio,
  color = 'var(--ds-accent)',
  size = 30
}: {
  ratio: number
  color?: string
  size?: number
}): ReactElement {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
  const stroke = 3.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden focusable="false">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--ds-border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * clamped} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/**
 * Sparkline over a series, with the final point marked.
 *
 * Used for the degree distribution, so the shape of the graph's connectivity —
 * a few hubs versus an even spread — is visible next to the average.
 */
export function NodeGraphSparkline({
  values,
  width = 84,
  height = 26,
  color = 'var(--ds-accent)'
}: {
  values: readonly number[]
  width?: number
  height?: number
  color?: string
}): ReactElement | null {
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = Math.max(1e-6, max - min)
  const step = width / (values.length - 1)
  const pointAt = (value: number, index: number): [number, number] => [
    index * step,
    height - 2 - ((value - min) / span) * (height - 4)
  ]
  const points = values.map(pointAt)
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')
  const area = `M0,${height} L${line} L${width},${height} Z`
  const last = points.at(-1)!
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
      <path d={area} fill={color} opacity={0.14} />
      <path d={`M${line}`} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  )
}

/**
 * Cluster mark: one dot per detected cluster, sized by its share of the graph.
 * Caps at a dozen so a fragmented graph does not overflow the tile.
 */
export function NodeGraphClusterMark({
  sizes,
  width = 46,
  height = 30
}: {
  sizes: readonly number[]
  width?: number
  height?: number
}): ReactElement | null {
  const shown = sizes.slice(0, 12)
  if (shown.length === 0) return null
  const largest = Math.max(...shown, 1)
  const columns = Math.ceil(Math.sqrt(shown.length))
  const rows = Math.ceil(shown.length / columns)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
      {shown.map((size, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const cellWidth = width / columns
        const cellHeight = height / rows
        return (
          <circle
            key={index}
            cx={cellWidth * (column + 0.5)}
            cy={cellHeight * (row + 0.5)}
            r={2 + (size / largest) * 3.4}
            fill="var(--ds-accent)"
            opacity={0.35 + (size / largest) * 0.55}
          />
        )
      })}
    </svg>
  )
}
