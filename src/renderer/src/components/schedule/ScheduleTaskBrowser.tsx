import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { CheckCircle2, CircleAlert, Clock3, PencilLine, Play, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClawImChannelV1, ScheduledTaskV1, ScheduleRuntimeStatus } from '@shared/app-settings'
import type { ScheduleTasksBulkAction, ScheduleTasksBulkInput } from '@shared/schedule-task-bulk'
import {
  filterScheduledTasks, formatDateTime, SCHEDULE_FILTERS, scheduleReasoningLabel,
  scheduleTaskSummary, scheduledTaskClawLabel, scheduledTaskDisplayStatus, statusTone,
  type ScheduleModelProviderOption, type TaskFilter
} from './schedule-task-support'
import { ScheduleTaskDetailPanel } from './ScheduleTaskDetailPanel'
import { ScheduleTasksDeleteConfirm } from './ScheduleTasksDeleteConfirm'
import styles from './ScheduleTaskBrowser.module.css'

type Props = {
  tasks: ScheduledTaskV1[]
  status: ScheduleRuntimeStatus | null
  clawChannels: ClawImChannelV1[]
  modelProviders: ScheduleModelProviderOption[]
  pending: boolean
  onBulk: (input: ScheduleTasksBulkInput) => Promise<void>
  onRun: (id: string) => Promise<void>
  onEdit: (task: ScheduledTaskV1) => void
  onOpenThread?: (id: string) => void
}

export function ScheduleTaskBrowser(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<ScheduledTaskV1[] | null>(null)
  const [pending, setPending] = useState(false)
  const [runIds, setRunIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const selectAll = useRef<HTMLInputElement>(null)
  const mutationLock = useRef(false)
  const runningRequests = useRef(new Set<string>())
  const visible = useMemo(() => filterScheduledTasks(props.tasks, filter, query, props.status), [props.tasks, props.status, filter, query])
  const chosen = visible.filter((task) => selected.has(task.id))
  const allChecked = visible.length > 0 && chosen.length === visible.length
  const disabled = pending || props.pending
  const detail = props.tasks.find((task) => task.id === detailId)

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = chosen.length > 0 && !allChecked
  }, [chosen.length, allChecked])
  useEffect(() => {
    const node = root.current
    if (!node) return
    const update = (): void => setNarrow(node.getBoundingClientRect().width < 1100)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(node)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])

  const mutate = async (action: ScheduleTasksBulkAction, targets: ScheduledTaskV1[]): Promise<void> => {
    if (mutationLock.current || props.pending || targets.length === 0) return
    if (action === 'enable' && targets.some((task) => !task.enabled && task.schedule.kind === 'at' && !(Date.parse(task.schedule.atTime) > Date.now()))) {
      setError(t('scheduleExpiredTasks'))
      return
    }
    mutationLock.current = true
    setPending(true)
    setError(null)
    setFeedback(null)
    try {
      await props.onBulk({ action, taskIds: targets.map((task) => task.id) })
      setSelected(new Set())
      setFeedback(t('scheduleActionComplete', { total: targets.length }))
      if (action === 'delete') {
        if (targets.some((task) => task.id === detailId)) setDetailId(null)
        setDeleteTargets(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      mutationLock.current = false
      setPending(false)
    }
  }
  const run = async (id: string): Promise<void> => {
    if (disabled || runningRequests.current.has(id)) return
    runningRequests.current.add(id)
    setRunIds(new Set(runningRequests.current))
    setError(null)
    try { await props.onRun(id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { runningRequests.current.delete(id); setRunIds(new Set(runningRequests.current)) }
  }
  const edit = (task: ScheduledTaskV1): void => { setDetailId(null); props.onEdit(task) }
  const clearSelection = (): void => { setSelected(new Set()); setFeedback(null) }
  const modelLabel = (task: ScheduledTaskV1): string => {
    const provider = props.modelProviders.find((item) => item.providerId === task.providerId)?.label
    return `${provider ? `${provider} / ` : ''}${task.model} · ${scheduleReasoningLabel(task.reasoningEffort, t)}`
  }

  return (
    <div ref={root} className={styles.browser}>
      <div className={styles.toolbar}>
        <div className={styles.filters} aria-label={t('scheduleFilterLabel')}>
          {SCHEDULE_FILTERS.map((value) => <button type="button" key={value} aria-pressed={filter === value}
            onClick={() => { setFilter(value); clearSelection() }}>{t(`scheduleFilter_${value}`)}{value === 'all' ? ` ${props.tasks.length}` : ''}</button>)}
        </div>
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label={t('scheduleSearch')} placeholder={t('scheduleSearch')} value={query}
            onChange={(event) => { setQuery(event.target.value); clearSelection() }} />
        </label>
      </div>
      {error && !deleteTargets ? <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-800 dark:text-red-100">
        <CircleAlert size={16} className="shrink-0" /><span className="flex-1">{error}</span><button type="button" onClick={() => setError(null)} aria-label={t('close')}><X size={16} /></button>
      </div> : null}
      {feedback ? <p role="status" className="mb-3 text-[12px] text-ds-muted">{feedback}</p> : null}
      <div className={`${styles.layout} ${detail && !narrow ? styles.withDetail : ''}`}>
        <div className={styles.listArea}>
          <div className={`${styles.bulk} ${chosen.length ? styles.selected : ''}`}>
            <label><input ref={selectAll} type="checkbox" aria-label={t('scheduleSelectAll')} checked={allChecked} disabled={disabled || !visible.length}
              onChange={(event) => setSelected(event.target.checked ? new Set(visible.map((task) => task.id)) : new Set())} />
              {chosen.length ? t('scheduleSelectedCount', { total: chosen.length }) : t('scheduleSelectAll')}</label>
            {chosen.length ? <>
              <button type="button" className={styles.button} disabled={disabled} onClick={() => void mutate('enable', chosen)}>{t('scheduleBulkEnable')}</button>
              <button type="button" className={styles.button} disabled={disabled} onClick={() => void mutate('disable', chosen)}>{t('scheduleBulkDisable')}</button>
              <button type="button" className={`${styles.button} ${styles.danger}`} disabled={disabled} onClick={() => { setError(null); setDeleteTargets(chosen) }}><Trash2 size={14} />{t('scheduleBulkDelete')}</button>
              <button type="button" className={styles.icon} disabled={disabled} onClick={clearSelection} aria-label={t('scheduleClearSelection')}><X size={16} /></button>
            </> : <span className={styles.hint}>{t('scheduleViewDetailsHint')}</span>}
          </div>
          {visible.length ? <div className={styles.table}>
            <div className={styles.tableHead} aria-hidden="true"><span /><span>{t('scheduleTaskName')}</span><span>{t('scheduleTaskSectionTiming')}</span><span>{t('scheduleNextRun')}</span><span>{t('scheduleQuickActions')}</span></div>
            {visible.map((task) => {
              const displayedStatus = scheduledTaskDisplayStatus(task, props.status)
              const busy = displayedStatus === 'running' || displayedStatus === 'queued' || runIds.has(task.id)
              const StatusIcon = displayedStatus === 'success' ? CheckCircle2 : displayedStatus === 'error' ? CircleAlert : Clock3
              return <div key={task.id} className={styles.row} data-selected={selected.has(task.id)} data-active={detailId === task.id}>
                <input type="checkbox" aria-label={t('scheduleSelectTask', { name: task.title || t('scheduleUntitled') })} checked={selected.has(task.id)} disabled={disabled}
                  onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(task.id); else next.delete(task.id); return next })} />
                <div className="min-w-0">
                  <div className={styles.title}>
                    <button type="button" className={styles.titleButton} aria-expanded={detailId === task.id} onClick={() => setDetailId(task.id)}>{task.title || t('scheduleUntitled')}</button>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${statusTone(displayedStatus)}`}><StatusIcon size={12} aria-hidden="true" />{t(`scheduleStatus_${displayedStatus}`)}</span>
                  </div>
                  <div className={`${styles.summary} ${styles.compactTiming}`}>{scheduleTaskSummary(task, t)} · {t('scheduleNextRun')}: {formatDateTime(task.nextRunAt, t('scheduleNotScheduled'))}</div>
                  <p className={styles.summary}>{task.lastMessage?.trim().replace(/\s+/gu, ' ') || task.workspaceRoot || t('scheduleNoResult')}</p>
                </div>
                <div className={styles.timing}>{scheduleTaskSummary(task, t)}</div>
                <div className={styles.next}>{formatDateTime(task.nextRunAt, t('scheduleNotScheduled'))}</div>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.icon} disabled={disabled || busy} onClick={() => void run(task.id)} title={t('scheduleRunNow')} aria-label={t('scheduleRunNow')}><Play size={16} /></button>
                  <button type="button" className={`${styles.icon} ${styles.edit}`} disabled={disabled} onClick={() => edit(task)} title={t('scheduleEditTask')} aria-label={t('scheduleEditTask')}><PencilLine size={16} /></button>
                  <button type="button" role="switch" aria-checked={task.enabled} aria-label={t('scheduleToggleTask', { name: task.title })} className={styles.switch} disabled={disabled}
                    onClick={() => void mutate(task.enabled ? 'disable' : 'enable', [task])}><span /></button>
                </div>
              </div>
            })}
          </div> : <div className={styles.empty}><Search size={24} /><span>{t(props.tasks.length ? 'scheduleFilterEmpty' : 'scheduleEmpty')}</span>
            {props.tasks.length ? <button type="button" className={styles.button} onClick={() => { setQuery(''); setFilter('all'); clearSelection() }}>{t('scheduleClearFilters')}</button> : null}
          </div>}
          <footer className={styles.footer}><span>{t('scheduleVisibleCount', { visible: visible.length, total: props.tasks.length })}</span><span>{t('scheduleRefreshHint')}</span></footer>
        </div>
        {detail ? <ScheduleTaskDetailPanel key={detail.id} task={detail} displayedStatus={scheduledTaskDisplayStatus(detail, props.status)}
          modelLabel={modelLabel(detail)} clawLabel={scheduledTaskClawLabel(detail, props.clawChannels, t)} modal={narrow} pending={disabled} runPending={runIds.has(detail.id)}
          onClose={() => setDetailId(null)} onRun={() => void run(detail.id)} onEdit={() => edit(detail)} onDelete={() => { setError(null); setDeleteTargets([detail]) }}
          onToggle={() => void mutate(detail.enabled ? 'disable' : 'enable', [detail])} onOpenThread={props.onOpenThread} /> : null}
      </div>
      {deleteTargets ? <ScheduleTasksDeleteConfirm tasks={deleteTargets}
        busyCount={deleteTargets.filter((task) => ['running', 'queued'].includes(scheduledTaskDisplayStatus(props.tasks.find((item) => item.id === task.id) ?? task, props.status))).length}
        pending={disabled} error={error} onCancel={() => { setDeleteTargets(null); setError(null) }} onConfirm={() => void mutate('delete', deleteTargets)} /> : null}
    </div>
  )
}
