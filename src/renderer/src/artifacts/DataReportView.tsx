import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react'
import type { DataReportBlock, DataReportInput, DataReportStat } from '../../../../kun/src/contracts/data-report'
import { parseRendererChartSpec, type RendererChartSpec } from '../agent/chart-spec-adapter'
import { ChartRenderer } from '../components/chat/ChartRenderer'

/** Report charts can always be expanded and exported; the agent does not pick chrome. */
const REPORT_CHART_ACTIONS: RendererChartSpec['actions'] = ['expand', 'download-png', 'download-csv']
/** Below this width half-width charts stack, so each keeps a readable plot. */
const TWO_COLUMN_MIN_WIDTH = 620

function useTwoColumns(): { ref: RefObject<HTMLDivElement | null>; twoColumns: boolean } {
  const ref = useRef<HTMLDivElement | null>(null)
  const [twoColumns, setTwoColumns] = useState(true)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) setTwoColumns(width >= TWO_COLUMN_MIN_WIDTH)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { ref, twoColumns }
}

export function formatReportStatValue(value: DataReportStat['value']): string {
  return typeof value === 'number' ? value.toLocaleString() : value
}

const TONE_CLASS: Record<NonNullable<DataReportStat['tone']>, string> = {
  positive: 'bg-ds-success-soft text-ds-status-success',
  negative: 'bg-ds-danger-soft text-ds-status-danger',
  neutral: 'bg-ds-subtle text-ds-muted'
}

function StatTile({ stat, large }: { stat: DataReportStat; large: boolean }): ReactElement {
  return (
    <div className="min-w-0 rounded-[14px] bg-ds-surface-subtle px-4 py-3.5" data-report-stat>
      <div className="truncate text-[12.5px] text-ds-muted">{stat.label}</div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`font-semibold tabular-nums text-ds-ink ${large ? 'text-[30px] leading-9' : 'text-[26px] leading-8'}`}>
          {formatReportStatValue(stat.value)}
        </span>
        {stat.delta ? (
          <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium tabular-nums ${TONE_CLASS[stat.tone ?? 'neutral']}`}>
            {stat.delta}
          </span>
        ) : null}
      </div>
      {stat.note ? <div className="mt-1 text-[12px] leading-5 text-ds-muted">{stat.note}</div> : null}
    </div>
  )
}

function StatsBlock({ items, large }: { items: DataReportStat[]; large: boolean }): ReactElement {
  const columns = Math.min(items.length, 4)
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${columns >= 4 ? 150 : 170}px, 1fr))` }}>
      {items.map((stat, index) => <StatTile key={`${stat.label}-${index}`} stat={stat} large={large} />)}
    </div>
  )
}

function TextBlock({ title, body }: { title?: string; body?: string }): ReactElement {
  return (
    <div className="min-w-0" data-report-text>
      {title ? <h3 className="text-[14px] font-semibold text-ds-ink">{title}</h3> : null}
      {body ? <p className="mt-1 whitespace-pre-line text-[12.5px] leading-5 text-ds-muted">{body}</p> : null}
    </div>
  )
}

function reportChartSpec(block: Extract<DataReportBlock, { type: 'chart' }>): RendererChartSpec | null {
  const spec = parseRendererChartSpec(block.chart)
  if (!spec) return null
  return block.chart.actions ? spec : { ...spec, actions: REPORT_CHART_ACTIONS }
}

function blockSpan(block: DataReportBlock, twoColumns: boolean): string {
  return twoColumns && block.type === 'chart' && block.width === 'half' ? '' : 'col-span-full'
}

/**
 * Kun-rendered data report: stat tiles, governed charts and short notes in
 * the order the agent sent them. Used by the conversation card and the
 * Artifacts viewer, so both always look the same.
 */
export function DataReportView({ report, limitBlocks, variant = 'card' }: {
  report: DataReportInput
  /** Render only the first N blocks (the transcript card collapses long reports). */
  limitBlocks?: number
  variant?: 'card' | 'page'
}): ReactElement {
  const { ref, twoColumns } = useTwoColumns()
  const blocks = useMemo(
    () => (limitBlocks === undefined ? report.blocks : report.blocks.slice(0, limitBlocks)),
    [report.blocks, limitBlocks]
  )
  return (
    <div ref={ref} className="grid min-w-0 grid-cols-2 gap-3" data-data-report={variant}>
      {blocks.map((block, index) => {
        const span = blockSpan(block, twoColumns)
        if (block.type === 'stats') {
          return <div key={index} className={`${span} min-w-0`}><StatsBlock items={block.items} large={variant === 'page'} /></div>
        }
        if (block.type === 'text') {
          return <div key={index} className={`${span} min-w-0 ${index > 0 ? 'pt-2' : ''}`}><TextBlock title={block.title} body={block.body} /></div>
        }
        const spec = reportChartSpec(block)
        return spec
          ? <div key={index} className={`${span} min-w-0`}><ChartRenderer spec={spec} embedded /></div>
          : null
      })}
    </div>
  )
}
