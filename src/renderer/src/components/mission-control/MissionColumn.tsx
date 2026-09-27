import { useRef, type ReactElement } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ActivityRow } from '@shared/activity-row'
import type { ActivityDisplayBucket } from '@shared/activity-display'
import type { AdeQuestionRecord } from '@shared/ade-teams'
import { MissionCard, type MissionCardStats } from './MissionCard'

const MISSION_VIRTUALIZE_THRESHOLD = 100
const MISSION_CARD_ESTIMATE = 96

export type MissionColumnProps = {
  bucket: ActivityDisplayBucket
  label: string
  rows: ActivityRow[]
  tinted: boolean
  statsOf: (row: ActivityRow) => MissionCardStats | null | undefined
  questionOf: (row: ActivityRow) => AdeQuestionRecord | undefined
  expanded: ReadonlySet<string>
  childRowsOf: (row: ActivityRow) => ActivityRow[]
  onOpen: (row: ActivityRow) => void
  onAnswer: (questionId: string, answer: string) => Promise<void>
  onToggleExpand: (row: ActivityRow) => void
}

/**
 * One Mission Control column (docs/ade/12 §5.1): header = label + count;
 * only needs-you/review carry a tinted header. Card lists virtualize past
 * 100 entries with the shared @tanstack/react-virtual scroller.
 */
export function MissionColumn({
  bucket,
  label,
  rows,
  tinted,
  statsOf,
  questionOf,
  expanded,
  childRowsOf,
  onOpen,
  onAnswer,
  onToggleExpand
}: MissionColumnProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => MISSION_CARD_ESTIMATE,
    overscan: 8,
    enabled: rows.length > MISSION_VIRTUALIZE_THRESHOLD
  })

  const card = (row: ActivityRow): ReactElement => (
    <MissionCard
      key={row.unitId}
      row={row}
      stats={statsOf(row)}
      openQuestion={questionOf(row)}
      expanded={expanded.has(row.unitId)}
      childRows={childRowsOf(row)}
      childStatsOf={statsOf}
      onOpen={onOpen}
      onAnswer={onAnswer}
      onToggleExpand={onToggleExpand}
    />
  )

  return (
    <section
      data-mission-column={bucket}
      className="flex min-h-0 w-64 shrink-0 flex-col rounded-xl border border-ds-border-muted bg-ds-subtle/40"
    >
      <header
        data-mission-column-header={bucket}
        className={`flex items-center justify-between rounded-t-xl px-3 py-2 text-[12px] font-medium ${
          tinted
            ? bucket === 'needs-you'
              ? 'bg-ds-warning-soft text-ds-status-warning'
              : 'bg-ds-success-soft text-ds-status-success'
            : 'text-ds-muted'
        }`}
      >
        <span>{label}</span>
        <span className="tabular-nums">{rows.length}</span>
      </header>
      {rows.length > MISSION_VIRTUALIZE_THRESHOLD ? (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`
                }}
              >
                {card(rows[item.index]!)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
          {rows.map(card)}
        </div>
      )}
    </section>
  )
}
