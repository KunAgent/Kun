import type { ReactElement } from 'react'
import type { DataReportFile } from '../../../../kun/src/contracts/data-report'
import type { LibraryArtifact } from './artifact-types'
import { useDataReportFile } from './data-report-file'
import { formatReportStatValue } from './DataReportView'

type Sketch = { kind: 'line' | 'bar'; values: number[] }

/** The first plottable series, scaled into a small sketch for the card cover. */
export function reportSketch(report: Pick<DataReportFile, 'blocks'>): Sketch | null {
  for (const block of report.blocks) {
    if (block.type !== 'chart') continue
    const { chart } = block
    const field = chart.series?.[0]?.field ?? chart.y?.field
    if (!field || !['line', 'area', 'bar'].includes(chart.type)) continue
    const values = chart.data.map((row) => row[field]).filter((value): value is number => typeof value === 'number').slice(0, 40)
    if (values.length >= 2) return { kind: chart.type === 'bar' ? 'bar' : 'line', values }
  }
  return null
}

function SketchSvg({ sketch }: { sketch: Sketch }): ReactElement {
  const width = 220
  const height = 64
  const max = Math.max(...sketch.values)
  const min = Math.min(0, ...sketch.values)
  const range = max - min || 1
  const y = (value: number): number => height - 6 - ((value - min) / range) * (height - 12)
  if (sketch.kind === 'bar') {
    const step = width / sketch.values.length
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full text-accent" aria-hidden>
        {sketch.values.map((value, index) => (
          <rect key={index} x={index * step + step * 0.2} y={y(value)} width={step * 0.6} height={Math.max(2, height - 6 - y(value))} rx={2} fill="currentColor" />
        ))}
      </svg>
    )
  }
  const step = width / (sketch.values.length - 1)
  const points = sketch.values.map((value, index) => `${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full text-accent" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Card cover drawn from the saved report itself: first metrics and first chart. */
export function DataReportThumbnail({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const file = useDataReportFile({ workspaceRoot: artifact.workspaceRoot, path: artifact.path, version: artifact.updatedAt })
  const report = file.status === 'ready' ? file.report : null
  const stats = report?.blocks.find((block) => block.type === 'stats')
  const sketch = report ? reportSketch(report) : null
  return (
    <div className="flex w-[232px] flex-col gap-2" data-report-thumbnail>
      {stats && stats.type === 'stats' ? (
        <div className="grid grid-cols-3 gap-1.5">
          {stats.items.slice(0, 3).map((stat, index) => (
            <div key={index} className="min-w-0 rounded-md bg-white px-2 py-1.5 dark:bg-ds-card">
              <div className="truncate text-[9px] text-ds-muted">{stat.label}</div>
              <div className="truncate text-[13px] font-semibold tabular-nums text-ds-ink">{formatReportStatValue(stat.value)}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="rounded-md bg-white px-2 py-1 dark:bg-ds-card">
        {sketch ? <SketchSvg sketch={sketch} /> : <div className="h-16" />}
      </div>
    </div>
  )
}
