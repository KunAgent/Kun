import { useCallback, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowUpRight, Bot, ChevronRight, X } from 'lucide-react'
import { useWorkerActions } from '../../workers/use-worker-actions'
import { openWorkerSession } from '../../workers/worker-view-store'
import {
  openAgentCenter,
  splitDispatchableNames,
  useDispatchableAgentNames
} from '../FloatingComposerDispatchableAgents'
import { requestOpenWorkersPanel } from '../FloatingComposerWorkersPill'
import { formatTrayDuration, useTrayNow, type TrayTranslate } from './tray-elapsed'
import {
  TrayAvatar,
  TrayButton,
  TrayIconButton,
  TrayRow,
  TraySheetBody,
  TraySheetHeader,
  TrayStatusPill,
  TrayStopButton
} from './tray-primitives'
import {
  longestRunningSince,
  workerAwaitsAnswer,
  workerRowNote,
  workerRunningActivity,
  workerStopRowData,
  workersSheetSummaryParts,
  type WorkersTrayRow
} from './workers-tray-model'

/**
 * Workers sheet: header (协作 · longest running clock · counts · "在协作面板
 * 打开 ↗" · collapse), one two-line row per worker (scrolling past ~3.5
 * rows), and on a manager session a dashed footer with the agents it can
 * still hand work to. A row opens that worker's own tab in the right panel;
 * waiting rows carry a dark "去回答 / 去处理" that does the same.
 */
export function WorkersTraySheet({
  rows,
  compact,
  unknown,
  dispatchEnabled,
  openSettings,
  onClose
}: {
  rows: readonly WorkersTrayRow[]
  compact: boolean
  /** The activity feed is down: show the last confirmed state, explained. */
  unknown: boolean
  /** Manager session: list the dispatchable agents in the footer. */
  dispatchEnabled: boolean
  openSettings?: unknown
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const nowMs = useTrayNow(rows.some((row) => row.status === 'running'))
  const reload = useCallback(() => Promise.resolve(), [])
  const { busy, error, dismissError, stop } = useWorkerActions(reload)

  const openRow = (row: WorkersTrayRow): void => {
    openWorkerSession(row.id, row.title)
    onClose()
  }
  const openPanel = (): void => {
    requestOpenWorkersPanel()
    onClose()
  }
  const since = longestRunningSince(rows)
  const summary = unknown
    ? [t('backgroundTaskUnknownHint')]
    : [
        ...(since != null ? [formatTrayDuration((nowMs - since) / 1000, t)] : []),
        ...workersSheetSummaryParts(rows, t)
      ]

  return (
    <div data-workers-tray-sheet>
      <TraySheetHeader
        title={t('composerTrayWorkers.title')}
        summary={summary.join(' · ')}
        actions={compact ? (
          <TrayIconButton label={t('composerTrayWorkers.openPanel')} onClick={openPanel} data-workers-tray-open-panel>
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </TrayIconButton>
        ) : (
          <TrayButton
            onClick={openPanel}
            trailingIcon={<ArrowUpRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}
            data-workers-tray-open-panel
          >
            {t('composerTrayWorkers.openPanel')}
          </TrayButton>
        )}
        onCollapse={onClose}
      />
      <TraySheetBody className="-m-0.5 max-h-[196px] overflow-y-auto overscroll-contain p-0.5" data-workers-tray-rows>
        {rows.map((row) => (
          <WorkerTrayRowView
            key={row.id}
            row={row}
            nowMs={nowMs}
            compact={compact}
            t={t}
            stopping={busy?.id === row.id && busy.action === 'stop'}
            onOpen={() => openRow(row)}
            onStop={() => {
              const target = workerStopRowData(row)
              if (target) stop(target)
            }}
          />
        ))}
      </TraySheetBody>
      {error ? (
        <div
          role="alert"
          className="mx-1 mt-1.5 flex items-start gap-2 rounded-[10px] bg-ds-danger-soft py-1 pl-2.5 pr-1 text-[12px] leading-[18px] text-ds-status-danger"
          data-workers-tray-error
        >
          <AlertCircle className="mt-1 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words py-1">{error}</span>
          <TrayIconButton label={t('close')} onClick={dismissError}>
            <X className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
          </TrayIconButton>
        </div>
      ) : null}
      {dispatchEnabled ? (
        <WorkersDispatchFooter onManage={() => {
          onClose()
          openAgentCenter(openSettings)
        }} />
      ) : null}
    </div>
  )
}

function Chevron(): ReactElement {
  // Decorative: clicks fall through to the row's open target underneath.
  return (
    <span className="pointer-events-none inline-flex h-[26px] w-[26px] items-center justify-center text-ds-muted" aria-hidden="true">
      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  )
}

function WorkerTrayRowView({
  row,
  nowMs,
  compact,
  t,
  stopping,
  onOpen,
  onStop
}: {
  row: WorkersTrayRow
  nowMs: number
  compact: boolean
  t: TrayTranslate
  stopping: boolean
  onOpen: () => void
  onStop: () => void
}): ReactElement {
  let subtitle: string
  let trailing: ReactNode
  if (row.status === 'running') {
    const startedMs = Date.parse(row.since)
    const elapsed = Number.isFinite(startedMs)
      ? t('composerTrayWorkers.runningFor', { duration: formatTrayDuration((nowMs - startedMs) / 1000, t) })
      : ''
    const stalled = row.source.stalled ? t('adeStatusStalled') : ''
    subtitle = [elapsed, workerRunningActivity(row, t), stalled].filter(Boolean).join(' · ')
  } else {
    subtitle = workerRowNote(row, t)
  }

  if (row.status === 'waiting') {
    trailing = (
      <>
        {compact ? null : <TrayStatusPill tone="waiting">{t('composerTrayWorkers.status.waiting')}</TrayStatusPill>}
        <TrayButton variant="solid" onClick={onOpen} data-workers-tray-resolve={row.id}>
          {workerAwaitsAnswer(row) ? t('composerTrayWorkers.answer') : t('composerTrayWorkers.resolve')}
        </TrayButton>
      </>
    )
  } else if (row.status === 'running' || row.status === 'starting') {
    trailing = (
      <>
        {row.stop ? (
          <span className="inline-flex" data-workers-tray-stop={row.id}>
            <TrayStopButton
              onClick={onStop}
              disabled={stopping}
              iconOnly={compact}
              label={compact ? t('composerTrayWorkers.stopWorker', { title: row.title }) : undefined}
            />
          </span>
        ) : null}
        <Chevron />
      </>
    )
  } else {
    const pill = row.status === 'failed'
      ? <TrayStatusPill tone="error">{t('composerTrayWorkers.status.failed')}</TrayStatusPill>
      : row.status === 'review'
        ? <TrayStatusPill>{t('composerTrayWorkers.status.review')}</TrayStatusPill>
        : row.status === 'unconfirmed'
          ? <TrayStatusPill>{t('composerTrayWorkers.status.unconfirmed')}</TrayStatusPill>
          : row.source.lastOutcome === 'cancelled'
            ? <TrayStatusPill>{t('composerTrayWorkers.status.cancelled')}</TrayStatusPill>
            : <TrayStatusPill tone="done">{t('composerTrayWorkers.status.done')}</TrayStatusPill>
    trailing = (
      <>
        {pill}
        <Chevron />
      </>
    )
  }

  return (
    <TrayRow
      data-worker-tray-row={row.id}
      data-worker-tray-status={row.status}
      leading={<TrayAvatar size="lg" label={row.glyph} color={row.color} />}
      title={row.title}
      subtitle={subtitle || ' '}
      highlighted={row.status === 'waiting'}
      onOpen={onOpen}
      openLabel={t('composerTrayWorkers.openWorker', { title: row.title })}
      trailing={trailing}
    />
  )
}

/** "还可以派给：Claude Code · Codex · OpenCode +2 ………… 管理 Agent" */
function WorkersDispatchFooter({ onManage }: { onManage: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const names = useDispatchableAgentNames(true)
  const { shown, extra } = splitDispatchableNames(names)
  return (
    <div
      className="mt-1.5 flex min-h-8 min-w-0 items-center gap-2 border-t border-dashed border-[color:color-mix(in_srgb,var(--ds-text)_8%,transparent)] pl-2.5 pr-1 text-[12px] text-ds-muted"
      data-workers-tray-dispatch
    >
      <Bot className="h-[13px] w-[13px] shrink-0" strokeWidth={2} aria-hidden="true" />
      {names.length > 0 ? (
        <span className="min-w-0 truncate" title={names.join(', ')}>
          {t('composerTrayWorkers.dispatchFooter', { names: shown.join(' · ') })}
          {extra > 0 ? <span className="text-ds-faint tabular-nums"> +{extra}</span> : null}
        </span>
      ) : (
        <span className="min-w-0 truncate text-ds-status-warning">{t('adeDispatchableNone')}</span>
      )}
      <span className="flex-1" />
      <TrayButton onClick={onManage} data-workers-tray-manage-agents>
        {t('composerTrayWorkers.manageAgents')}
      </TrayButton>
    </div>
  )
}
