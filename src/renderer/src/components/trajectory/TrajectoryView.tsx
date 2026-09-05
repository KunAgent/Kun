import { Activity } from 'lucide-react'
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { trajectoryUiState, useTrajectoryUiStore } from '../../store/trajectory-ui-store'
import { TrajectoryInspector } from './TrajectoryInspector'
import type { fetchTrajectoryDetail } from '../../agent/trajectory'
import { TrajectoryLedger } from './TrajectoryLedger'
import { TrajectoryTimeline } from './TrajectoryTimeline'
import { TrajectoryToolbar } from './TrajectoryToolbar'
import {
  deriveHarnessLayout,
  projectHarnessCells,
  type HarnessRequestBoundary
} from './trajectory-harness-model'
import {
  deriveHarnessTimeline,
  harnessTimelineFocusIds,
  type HarnessTimelineMode
} from './trajectory-harness-timeline'
import type { TrajectoryData } from './useTrajectoryData'
import styles from './TrajectoryView.module.css'

const DURATION_STORAGE_KEY = 'kun.trajectory.actual-duration'

export function TrajectoryView({
  threadId,
  data,
  detailLoader
}: {
  threadId: string
  data: TrajectoryData
  detailLoader?: typeof fetchTrajectoryDetail
}): ReactElement {
  const { t } = useTranslation('common')
  const byThread = useTrajectoryUiStore((state) => state.byThread)
  const update = useTrajectoryUiStore((state) => state.update)
  const ui = trajectoryUiState(byThread, threadId)
  const [actualDuration, setActualDurationState] = useState(() => {
    try { return localStorage.getItem(DURATION_STORAGE_KEY) === 'true' } catch { return false }
  })
  const layout = useMemo(() => deriveHarnessLayout(data.records), [data.records])
  const collapsedTurns = useMemo(() => new Set(ui.collapsedTurnIds), [ui.collapsedTurnIds])
  const collapsedCalls = useMemo(() => new Set(ui.collapsedCallIds), [ui.collapsedCallIds])
  const cells = useMemo(() => projectHarnessCells({
    layout,
    collapsedTurns,
    collapsedCalls,
    searchQuery: ui.query
  }), [collapsedCalls, collapsedTurns, layout, ui.query])
  const timelineMode: HarnessTimelineMode = actualDuration ? 'duration' : 'sequence'
  const timelineCells = useMemo(() => layout.cells.filter((cell) => !cell.requestOnly), [layout.cells])
  const timelineModel = useMemo(() => deriveHarnessTimeline(timelineCells, timelineMode), [timelineCells, timelineMode])
  const focusIds = useMemo(() => harnessTimelineFocusIds(timelineModel, ui.timelineRange), [timelineModel, ui.timelineRange])
  const selectedCell = layout.cells.find((cell) => cell.id === ui.selectedRecordId) ?? null
  const selectedRequest: HarnessRequestBoundary | null = ui.selectedRequestId
    ? layout.requests.find((request) => request.request.requestId === ui.selectedRequestId) ?? null
    : null
  const parentRequest: HarnessRequestBoundary | null = selectedCell?.parentRequestId
    ? layout.requests.find((request) => request.request.requestId === selectedCell.parentRequestId) ?? null
    : null
  const collapsibleTurns = layout.turns.filter((turn) => turn.cells.length > 1).map((turn) => turn.id)
  const callAssistants = layout.cells.filter((cell, index) => cell.kind === 'assistant' &&
    layout.cells.slice(index + 1).some((candidate) => candidate.parentRequestId === cell.parentRequestId && (candidate.kind === 'tool' || candidate.kind === 'subtool')))
  const allTurnsCollapsed = collapsibleTurns.length > 0 && collapsibleTurns.every((id) => collapsedTurns.has(id))
  const allCallsCollapsed = callAssistants.length > 0 && callAssistants.every((cell) => collapsedCalls.has(cell.id))

  const setActualDuration = (value: boolean): void => {
    setActualDurationState(value)
    update(threadId, { timelineRange: null })
    try { localStorage.setItem(DURATION_STORAGE_KEY, String(value)) } catch { /* unavailable local storage */ }
  }
  const toggleAllTurns = (): void => update(threadId, { collapsedTurnIds: allTurnsCollapsed ? [] : collapsibleTurns })
  const toggleAllCalls = (): void => update(threadId, { collapsedCallIds: allCallsCollapsed ? [] : callAssistants.map((cell) => cell.id) })

  return (
    <div className={`${styles.root} ds-no-drag`} data-testid="trajectory-view" data-conversation-composer-overlay="">
      <TrajectoryToolbar
        actualDuration={actualDuration}
        allTurnsCollapsed={allTurnsCollapsed}
        allCallsCollapsed={allCallsCollapsed}
        searchQuery={ui.query}
        onActualDurationChange={setActualDuration}
        onToggleTurns={toggleAllTurns}
        onToggleCalls={toggleAllCalls}
        onSearchQueryChange={(query) => update(threadId, { query })}
      />
      <TrajectoryTimeline
        cells={timelineCells}
        mode={timelineMode}
        range={ui.timelineRange}
        selectedId={ui.selectedRecordId}
        hasEarlierRecords={Boolean(data.nextCursor)}
        onRangeChange={(timelineRange) => update(threadId, { timelineRange })}
        onRecordSelect={(selectedRecordId) => update(threadId, { selectedRecordId, selectedRequestId: null })}
        onLoadEarlier={data.loadOlder}
      />
      {data.error ? <Empty title={t('trajectoryLoadError')} detail={data.error} /> : data.loading && !data.records.length ? <Empty title={t('trajectoryLoading')} detail="" /> : !data.records.length ? <Empty title={t('trajectoryEmpty')} detail={t('trajectoryEmptyHint')} /> : (
        <div className={styles.ledger}>
          <TrajectoryLedger
            cells={cells}
            selectedId={ui.selectedRecordId}
            focusIds={focusIds}
            hasOlder={Boolean(data.nextCursor)}
            loadingOlder={data.loadingOlder}
            initialScrollOffset={ui.scrollOffset}
            onSelect={(selectedRecordId) => update(threadId, { selectedRecordId, selectedRequestId: null })}
            onSelectRequest={(selectedRequestId) => update(threadId, { selectedRequestId, selectedRecordId: null })}
            onClearSelection={() => update(threadId, { selectedRecordId: null, selectedRequestId: null })}
            onToggleTurn={(turnId) => {
              const next = new Set(collapsedTurns); if (next.has(turnId)) next.delete(turnId); else next.add(turnId)
              update(threadId, { collapsedTurnIds: [...next] })
            }}
            onToggleCalls={(id) => {
              const next = new Set(collapsedCalls); if (next.has(id)) next.delete(id); else next.add(id)
              update(threadId, { collapsedCallIds: [...next] })
            }}
            onLoadOlder={data.loadOlder}
            onScrollOffset={(scrollOffset) => update(threadId, { scrollOffset })}
          />
          <TrajectoryInspector
            threadId={threadId}
            cell={selectedCell}
            request={selectedRequest}
            parentRequest={parentRequest}
            width={ui.inspectorWidth}
            onWidthChange={(inspectorWidth) => update(threadId, { inspectorWidth })}
            onClose={() => update(threadId, { selectedRecordId: null, selectedRequestId: null })}
            onSelectParentRequest={(selectedRequestId) => update(threadId, { selectedRequestId, selectedRecordId: null })}
            onSelectToolCall={(callId) => {
              const target = layout.cells.find((cell) => cell.callId === callId)
              if (target) update(threadId, { selectedRecordId: target.id, selectedRequestId: null })
            }}
            loadDetail={detailLoader}
          />
        </div>
      )}
    </div>
  )
}

function Empty({ title, detail }: { title: string; detail: string }): ReactElement {
  return <div className={styles.empty}><Activity /><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</div>
}
