import type { ReactElement } from 'react'
import type { ChartTooltipItem } from './chart-renderer-layout'

export type ChartHover = {
  category: string
  items: ChartTooltipItem[]
  x: number
  y: number
}

export function ChartTooltip({ hover }: { hover: ChartHover | null }): ReactElement | null {
  if (!hover) return null
  return (
    <div
      role="tooltip"
      data-chart-tooltip
      className="pointer-events-none absolute z-10 min-w-32 rounded-lg border border-ds-border bg-ds-surface-elevated px-2.5 py-2 text-xs shadow-lg"
      style={{ left: hover.x + 12, top: hover.y + 12 }}
    >
      <div className="font-medium text-ds-ink">{hover.category}</div>
      <ul className="mt-1 space-y-0.5">
        {hover.items.map((item) => (
          <li key={`${item.label}-${item.value}`} className="flex items-center gap-2 text-ds-muted">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="tabular-nums text-ds-ink">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChartLegend({
  items
}: {
  items: Array<{ field: string; label: string; color: string }>
}): ReactElement | null {
  if (items.length === 0) return null
  return (
    <ul data-chart-legend className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.field} className="flex items-center gap-1.5 text-xs text-ds-muted">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
