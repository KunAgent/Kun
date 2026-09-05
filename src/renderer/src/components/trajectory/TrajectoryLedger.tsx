import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Bot, Check, FileText, Info, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { HarnessCell } from './trajectory-harness-model'
import {
  HARNESS_VIRTUALIZATION_THRESHOLD,
  HARNESS_VIRTUAL_OVERSCAN,
  harnessVirtualRows
} from './trajectory-harness-virtual'
import styles from './TrajectoryLedger.module.css'

const BOTTOM_FOLLOW_THRESHOLD = 2

export function TrajectoryLedger({
  cells,
  selectedId,
  focusIds,
  hasOlder,
  loadingOlder,
  initialScrollOffset,
  onSelect,
  onSelectRequest,
  onClearSelection,
  onToggleTurn,
  onToggleCalls,
  onLoadOlder,
  onScrollOffset
}: {
  cells: readonly HarnessCell[]
  selectedId: string | null
  focusIds: ReadonlySet<string> | null
  hasOlder: boolean
  loadingOlder: boolean
  initialScrollOffset: number
  onSelect: (id: string) => void
  onSelectRequest: (requestId: string) => void
  onClearSelection: () => void
  onToggleTurn: (turnId: string) => void
  onToggleCalls: (assistantId: string) => void
  onLoadOlder: () => void
  onScrollOffset: (offset: number) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const initialized = useRef(false)
  const previousCount = useRef(cells.length)
  const previousIds = useRef(new Set(cells.map((cell) => cell.id)))
  const latestStartedAt = useRef(latestCellTime(cells))
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const [newRecordCount, setNewRecordCount] = useState(0)
  const rows = useMemo(() => harnessVirtualRows(cells), [cells])
  const virtual = rows.length > HARNESS_VIRTUALIZATION_THRESHOLD || hasOlder
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.height ?? 30,
    overscan: HARNESS_VIRTUAL_OVERSCAN,
    getItemKey: (index) => rows[index]?.key ?? index
  })
  const rendered = virtual
    ? virtualizer.getVirtualItems()
    : rows.map((row, index) => ({ index, start: 0, end: 0, size: row.height, key: row.key, lane: 0 }))
  const virtualTop = virtual ? rendered[0]?.start ?? 0 : 0
  const virtualBottom = virtual
    ? Math.max(0, virtualizer.getTotalSize() - (rendered.at(-1)?.end ?? 0))
    : 0

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || initialized.current) return
    initialized.current = true
    scroller.scrollTop = initialScrollOffset || scroller.scrollHeight
  }, [initialScrollOffset])

  useEffect(() => {
    if (!selectedId) return
    const index = rows.findIndex((row) => row.cell.id === selectedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [rows, selectedId, virtualizer])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || previousCount.current === cells.length) return
    const knownIds = previousIds.current
    const previousLatest = latestStartedAt.current
    const liveIncoming = cells.filter((cell) =>
      !knownIds.has(cell.id) && (cell.startedAt ?? 0) >= previousLatest).length
    previousCount.current = cells.length
    previousIds.current = new Set(cells.map((cell) => cell.id))
    latestStartedAt.current = latestCellTime(cells)
    if (anchor.current) {
      requestAnimationFrame(() => {
        const saved = anchor.current
        if (saved && scrollRef.current) {
          scrollRef.current.scrollTop = saved.top + (scrollRef.current.scrollHeight - saved.height)
        }
        anchor.current = null
      })
    } else if (atBottom.current) {
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })
      setNewRecordCount(0)
    } else if (liveIncoming > 0) {
      setNewRecordCount((count) => count + liveIncoming)
    }
  }, [cells])

  const loadOlder = (): void => {
    const scroller = scrollRef.current
    if (scroller) anchor.current = { height: scroller.scrollHeight, top: scroller.scrollTop }
    onLoadOlder()
  }
  const onScroll = (): void => {
    const scroller = scrollRef.current
    if (!scroller) return
    atBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_FOLLOW_THRESHOLD
    if (atBottom.current) setNewRecordCount(0)
    onScrollOffset(scroller.scrollTop)
  }
  const jumpToLive = (): void => {
    const scroller = scrollRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
    atBottom.current = true
    setNewRecordCount(0)
  }

  return (
    <div className={styles.split} onClick={(event) => { if (event.target === event.currentTarget) onClearSelection() }}>
      <div ref={scrollRef} className={styles.tablePane} onScroll={onScroll} data-trajectory-scroll="">
        <table className={styles.table} data-scroll-ready="true" aria-rowcount={rows.length + (hasOlder ? 2 : 1)}>
          <colgroup><col className={styles.eventColumn} /><col className={styles.contentColumn} /></colgroup>
          <thead><tr><th className={styles.eventHeader}>{t('trajectoryEvent')}</th><th>{t('trajectoryContent')}</th></tr></thead>
          <tbody>
            {hasOlder ? (
              <tr className={styles.historyLoadRow} data-history-load="" aria-rowindex={2}><td colSpan={2}>
                <button type="button" className={styles.historyLoadButton} disabled={loadingOlder} onClick={loadOlder}>
                  {loadingOlder ? t('trajectoryLoadingOlder') : t('trajectoryLoadOlder')}
                </button>
              </td></tr>
            ) : null}
            {virtualTop > 0 ? <tr className={styles.virtualSpacer} aria-hidden="true"><td colSpan={2} style={{ height: virtualTop }} /></tr> : null}
            {rendered.map((item) => {
              const cell = rows[item.index]?.cell
              if (!cell) return null
              const previous = cells[item.index - 1]
              const turnStart = previous?.turnId !== cell.turnId
              const selected = selectedId === cell.id
              const outside = focusIds !== null && !focusIds.has(cell.id)
              const collapsed = cell.collapsedSummary
              if (cell.requestOnly && cell.request) return (
                <tr
                  key={cell.id}
                  className={styles.terminalBoundary}
                  data-terminal-request-boundary=""
                  aria-rowindex={item.index + (hasOlder ? 3 : 2)}
                >
                  <td colSpan={2}>
                    <button
                      type="button"
                      className={styles.terminalRequest}
                      data-status={cell.request.request.status}
                      aria-label={`Request #${cell.request.number}`}
                      title={`Request #${cell.request.number}`}
                      onClick={() => onSelectRequest(cell.request!.request.requestId)}
                    />
                  </td>
                </tr>
              )
              return (
                <tr
                  key={cell.id}
                  tabIndex={0}
                  aria-rowindex={item.index + (hasOlder ? 3 : 2)}
                  data-trajectory-row-key={cell.id}
                  data-kind={cell.kind}
                  data-turn-start={turnStart || undefined}
                  data-selected={selected || undefined}
                  data-error={cell.status === 'failed' || undefined}
                  data-timeline-focus={outside ? 'outside' : undefined}
                  data-collapsed-summary={collapsed || undefined}
                  onClick={() => onSelect(cell.id)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(cell.id) } }}
                >
                  <td className={styles.event}>
                    <span className={styles.turnRail} />
                    {selected ? <span className={styles.selectionRail} /> : null}
                    {turnStart && cell.turn > 0 ? (
                      <button type="button" className={styles.turnLabel} onClick={(event) => { event.stopPropagation(); onToggleTurn(cell.turnId) }}>
                        <span className={styles.turnLabelFull}>Turn {cell.turn}</span><span className={styles.turnLabelCompact}>T{cell.turn}</span>
                      </button>
                    ) : null}
                    {cell.request ? (
                      <button
                        type="button"
                        className={styles.requestBoundary}
                        data-status={cell.request.request.status}
                        title={`Request #${cell.request.number}`}
                        aria-label={`Request #${cell.request.number}`}
                        onClick={(event) => { event.stopPropagation(); onSelectRequest(cell.request!.request.requestId) }}
                      />
                    ) : null}
                    <span className={styles.eventInner}><KindTag cell={cell} /></span>
                  </td>
                  <td className={styles.content}>
                    <div className={styles.contentRow}>
                      <span className={styles.contentText}>{collapsed ? `… ${cell.text}` : cellText(cell)}</span>
                      {cell.result && !collapsed ? <span className={styles.inlineResult}><span className={styles.arrow}>→</span>{cell.result}</span> : null}
                      {cell.durationMs !== null ? <span className={styles.duration}>{Math.round(cell.durationMs)}ms</span> : null}
                      {cell.kind === 'assistant' && nextCalls(cells, item.index) ? (
                        <button type="button" className={styles.foldCalls} onClick={(event) => { event.stopPropagation(); onToggleCalls(cell.id) }} aria-label={t('trajectoryCalls')}>⌄</button>
                      ) : null}
                      <Status cell={cell} />
                    </div>
                  </td>
                </tr>
              )
            })}
            {virtualBottom > 0 ? <tr className={styles.virtualSpacer} aria-hidden="true"><td colSpan={2} style={{ height: virtualBottom }} /></tr> : null}
          </tbody>
        </table>
      </div>
      {newRecordCount > 0 ? (
        <button type="button" className={styles.newRecords} onClick={jumpToLive}>
          {t('trajectoryNewRecords', { count: newRecordCount })}
        </button>
      ) : null}
    </div>
  )
}

function KindTag({ cell }: { cell: HarnessCell }): ReactElement {
  const Icon = cell.kind === 'assistant' ? Bot : cell.kind === 'tool' || cell.kind === 'subtool' ? Wrench : cell.kind === 'context' ? Info : FileText
  return <span className={styles.kindTag} data-trajectory-kind-tag="" data-kind={cell.kind}><Icon className={styles.kindIcon} /><span className={styles.kindLabel}>{cell.kind.toUpperCase()}</span></span>
}

function Status({ cell }: { cell: HarnessCell }): ReactElement | null {
  if (cell.status === 'completed') return <Check className={styles.statusComplete} data-trajectory-status="completed" />
  if (cell.status === 'failed') return <AlertTriangle className={styles.statusError} data-trajectory-status="failed" />
  if (cell.status === 'running') return <span className={styles.statusRunning} data-trajectory-status="running" />
  return null
}

function cellText(cell: HarnessCell): string {
  if (cell.kind === 'tool' || cell.kind === 'subtool') {
    const record = cell.record.kind === 'tool' || cell.record.kind === 'subtool' ? cell.record : null
    return record ? `${record.toolName}${record.argumentPreview ? ` ${record.argumentPreview}` : ''}` : cell.text
  }
  return cell.text || (cell.kind === 'assistant' ? 'No text output' : '—')
}

function nextCalls(cells: readonly HarnessCell[], index: number): boolean {
  const requestId = cells[index]?.parentRequestId
  return cells.slice(index + 1).some((cell) =>
    cell.parentRequestId === requestId && (cell.kind === 'tool' || cell.kind === 'subtool'))
}

function latestCellTime(cells: readonly HarnessCell[]): number {
  return Math.max(0, ...cells.map((cell) => cell.startedAt ?? 0))
}
