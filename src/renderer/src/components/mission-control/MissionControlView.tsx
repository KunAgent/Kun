import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Swords } from 'lucide-react'
import type { ActivityRow } from '@shared/activity-row'
import type { ActivityDisplayBucket } from '@shared/activity-display'
import { useActivityStore } from '../../store/activity-store'
import { selectBuckets, selectRowsForParent } from '../../store/activity-selectors'
import { useChatStore } from '../../store/chat-store'
import { getProvider } from '../../agent/registry'
import { MissionColumn } from './MissionColumn'
import { MissionToolbar } from './MissionToolbar'
import { RaceCompareView } from '../review/RaceCompareView'
import { useMissionLazyData } from './mission-lazy-data'
import {
  EMPTY_MISSION_FILTERS,
  filterMissionRows,
  missionFiltered,
  openQuestionFor,
  projectOfRow,
  workerDispatchStats,
  type MissionFilters
} from './mission-filters'
import type { MissionCardStats } from './MissionCard'

const SHOW_IDLE_KEY = 'kun.ade.mission.showIdle'

const COLUMNS: Array<{
  bucket: ActivityDisplayBucket
  labelKey: string
  tinted: boolean
}> = [
  { bucket: 'needs-you', labelKey: 'missionColumnNeedsYou', tinted: true },
  { bucket: 'working', labelKey: 'missionColumnWorking', tinted: false },
  { bucket: 'review', labelKey: 'missionColumnReview', tinted: true },
  { bucket: 'done', labelKey: 'missionColumnDone', tinted: false },
  { bucket: 'idle', labelKey: 'missionColumnIdle', tinted: false }
]

function readShowIdle(): boolean {
  try {
    return globalThis.localStorage?.getItem(SHOW_IDLE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * ADE home board (docs/ade/12 §5): ActivityStore rows grouped by the shared
 * displayBucket into needs-you / working / review / done / idle columns.
 * Card stats and question data hydrate lazily; only the two actionable
 * columns are tinted.
 */
export function MissionControlView(): ReactElement {
  const { t } = useTranslation('common')
  const rows = useActivityStore((s) => s.rows)
  const status = useActivityStore((s) => s.status)
  const [filters, setFilters] = useState<MissionFilters>(() => ({
    ...EMPTY_MISSION_FILTERS,
    showIdle: readShowIdle()
  }))
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [openRaceId, setOpenRaceId] = useState<string | null>(null)

  const buckets = useMemo(() => selectBuckets(rows), [rows])
  const allVisible = useMemo(
    () => Object.values(buckets).flat(),
    [buckets]
  )
  const lazy = useMissionLazyData(allVisible, expanded)

  const overviewFor = useCallback(
    (row: ActivityRow) => lazy.overviews[row.parentThreadId ?? row.threadId],
    [lazy.overviews]
  )
  const verdictOf = useCallback(
    (row: ActivityRow): string | undefined =>
      workerDispatchStats(overviewFor(row), row.unitId).verdict,
    [overviewFor]
  )

  const filtered = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(buckets) as ActivityDisplayBucket[]).map((bucket) => [
          bucket,
          filterMissionRows(buckets[bucket], filters, verdictOf)
        ])
      ) as Record<ActivityDisplayBucket, ActivityRow[]>,
    [buckets, filters, verdictOf]
  )

  // Same-task races reported by manager overviews (10 §6); opens compare view.
  const races = useMemo(
    () =>
      Object.values(lazy.overviews)
        .flatMap((overview) => overview?.races ?? [])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [lazy.overviews]
  )

  const projects = useMemo(
    () => [...new Set(allVisible.map(projectOfRow))].sort(),
    [allVisible]
  )
  const harnesses = useMemo(
    () => [...new Set(allVisible.map((row) => row.harnessId))].sort(),
    [allVisible]
  )
  const verdicts = useMemo(
    () => [...new Set(allVisible.map(verdictOf).filter((v): v is string => Boolean(v)))],
    [allVisible, verdictOf]
  )
  const resultCount = missionFiltered(filters) ? allVisible.length : 0

  const statsOf = useCallback(
    (row: ActivityRow): MissionCardStats | null | undefined => {
      const filesChanged = lazy.filesChanged[row.unitId]
      const { insertions, deletions, verdict } = workerDispatchStats(
        overviewFor(row),
        row.unitId
      )
      if (filesChanged === undefined && insertions === undefined && !verdict) {
        return undefined
      }
      return { filesChanged: filesChanged ?? undefined, insertions, deletions, verdict }
    },
    [lazy.filesChanged, overviewFor]
  )
  const questionOf = useCallback(
    (row: ActivityRow) => openQuestionFor(overviewFor(row), row.unitId),
    [overviewFor]
  )
  const childRowsOf = useCallback(
    (row: ActivityRow): ActivityRow[] =>
      expanded.has(row.unitId) ? selectRowsForParent(rows, row.threadId) : [],
    [expanded, rows]
  )

  const onChange = (next: MissionFilters): void => {
    setFilters(next)
    try {
      globalThis.localStorage?.setItem(SHOW_IDLE_KEY, next.showIdle ? '1' : '0')
    } catch {
      /* persistence is best-effort */
    }
  }
  const onOpen = (row: ActivityRow): void => {
    void useChatStore.getState().selectThread(row.threadId)
  }
  const onAnswer = async (questionId: string, answer: string): Promise<void> => {
    const provider = getProvider()
    if (!provider.answerTeamQuestion) return
    await provider.answerTeamQuestion(questionId, answer)
  }
  const onToggleExpand = (row: ActivityRow): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(row.unitId)) next.delete(row.unitId)
      else next.add(row.unitId)
      return next
    })
  }

  const visibleColumns = COLUMNS.filter(
    (c) => c.bucket !== 'idle' || filters.showIdle
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-ds-main" data-mission-control>
      <div className="flex items-center justify-between px-4 pt-3">
        <h1 className="text-[14px] font-semibold text-ds-ink">{t('missionControl')}</h1>
        <span className="text-[11px] text-ds-faint" data-feed-status={status}>
          {status === 'live' ? '' : t(`missionFeed_${status}`)}
        </span>
      </div>
      <MissionToolbar
        filters={filters}
        projects={projects}
        harnesses={harnesses}
        verdicts={verdicts}
        resultCount={resultCount}
        onChange={onChange}
      />
      {races.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          {races.map((race) => (
            <button
              key={race.raceId}
              type="button"
              onClick={() => setOpenRaceId(race.raceId)}
              className="inline-flex items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[11px] text-ds-muted hover:text-ds-ink"
            >
              <Swords className="h-3 w-3 text-ds-faint" strokeWidth={1.8} />
              <span className="max-w-40 truncate">{race.label}</span>
              <span className="text-ds-faint">{t(`raceState.${race.state}`)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-4 pb-3">
        {visibleColumns.map(({ bucket, labelKey, tinted }) => (
          <MissionColumn
            key={bucket}
            bucket={bucket}
            label={t(labelKey)}
            rows={filtered[bucket] ?? []}
            tinted={tinted}
            statsOf={statsOf}
            questionOf={questionOf}
            expanded={expanded}
            childRowsOf={childRowsOf}
            onOpen={onOpen}
            onAnswer={onAnswer}
            onToggleExpand={onToggleExpand}
          />
        ))}
        {allVisible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[12.5px] text-ds-faint">
            {t('missionEmpty')}
          </div>
        ) : null}
      </div>
      {openRaceId ? (
        <RaceCompareView raceId={openRaceId} onClose={() => setOpenRaceId(null)} />
      ) : null}
    </div>
  )
}
