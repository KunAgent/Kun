import type { ReactElement } from 'react'
import type { PaperUnitReadingActivity } from '@shared/paper/paper-library-types'

/**
 * R3.1 reading heat bar: a 48×4 segmented strip in the library row.
 * Each flex segment is one page — marked pages shade `accent` by mark count,
 * pages up to `lastPage` get a light "read" fill, the rest stay empty.
 */
export function PaperReadingHeat({
  activity,
  lastPage,
  pageCount,
  tooltip
}: {
  activity: PaperUnitReadingActivity | undefined
  lastPage: number | undefined
  pageCount: number | undefined
  /** Pre-formatted `批注 N 条 · 读到第 M/总 页` (falls back to a plain ratio). */
  tooltip: string
}): ReactElement | null {
  const pages = activity?.pages ?? []
  const total = Math.max(pageCount ?? 0, activity?.pageCount ?? 0, pages.length, lastPage ?? 0)
  const totalMarks = pages.reduce((sum, count) => sum + count, 0)
  if (total === 0 && totalMarks === 0) return null
  const segments = Math.max(total, 1)
  const last = Math.min(lastPage ?? 0, segments)
  return (
    <span className="flex w-12 items-center" title={tooltip}>
      <span className="flex h-1 w-full overflow-hidden rounded-full bg-ds-border-muted/70">
        {Array.from({ length: segments }, (_, index) => {
          const marks = pages[index] ?? 0
          const isRead = index + 1 <= last
          let color: string | undefined
          if (marks > 0) {
            // Depth encodes count: 1 mark ≈ 55% accent, 5+ ≈ solid accent.
            const pct = 55 + Math.min(marks - 1, 4) / 4 * 45
            color = `color-mix(in srgb, var(--ds-accent, #3b82f6) ${Math.round(pct)}%, transparent)`
          } else if (isRead) {
            color = 'color-mix(in srgb, var(--ds-accent, #3b82f6) 22%, transparent)'
          }
          return (
            <span
              key={index}
              className="h-full min-w-0 flex-1"
              style={color ? { backgroundColor: color } : undefined}
            />
          )
        })}
      </span>
    </span>
  )
}
