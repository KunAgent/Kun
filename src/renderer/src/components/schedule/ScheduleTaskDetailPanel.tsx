import { useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, PencilLine, Play, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ScheduledTaskV1 } from '@shared/app-settings'
import { useSchedulePanelFocus } from './use-schedule-panel-focus'
import { formatDateTime, scheduleTaskSummary, scheduledTaskLastThreadId, statusTone } from './schedule-task-support'
import styles from './ScheduleTaskBrowser.module.css'

type Props = {
  task: ScheduledTaskV1
  displayedStatus: ScheduledTaskV1['lastStatus']
  modelLabel: string
  clawLabel: string
  modal: boolean
  pending: boolean
  runPending: boolean
  onClose: () => void
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onOpenThread?: (threadId: string) => void
}

export function ScheduleTaskDetailPanel(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const { task, displayedStatus, pending, modal } = props
  const [tab, setTab] = useState<'result' | 'config'>('result')
  const panel = useRef<HTMLElement | null>(null)
  const titleId = useId()
  useSchedulePanelFocus(panel, props.onClose, modal)
  const threadId = scheduledTaskLastThreadId(task)
  const busy = displayedStatus === 'running' || displayedStatus === 'queued' || props.runPending
  const content = (
    <aside ref={panel} tabIndex={-1} role={modal ? 'dialog' : 'region'}
      aria-modal={modal || undefined} aria-labelledby={titleId} className={styles.panel}>
      <header className={styles.panelHeader}>
        <div className={styles.panelHeading}>
          <span>{t('scheduleTaskDetails')}</span>
          <button type="button" className={styles.icon} onClick={props.onClose} aria-label={t('close')}><X size={16} /></button>
        </div>
        <h2 id={titleId}>{task.title || t('scheduleUntitled')}</h2>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ds-muted">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusTone(displayedStatus)}`}>{t(`scheduleStatus_${displayedStatus}`)}</span>
          <span>{t(task.enabled ? 'scheduleFilter_enabled' : 'scheduleDisabled')}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={styles.button} disabled={pending || busy} onClick={props.onRun}><Play size={14} />{t('scheduleRunNow')}</button>
          <button type="button" className={styles.button} disabled={pending} onClick={props.onEdit}><PencilLine size={14} />{t('scheduleEditTask')}</button>
        </div>
      </header>
      <div className={styles.panelBody}>
        <dl className={styles.metadata}>
          <dt>{t('scheduleTaskSectionTiming')}</dt><dd>{scheduleTaskSummary(task, t)}</dd>
          <dt>{t('scheduleLastRun')}</dt><dd>{formatDateTime(task.lastRunAt, t('scheduleNeverRun'))}</dd>
          <dt>{t('scheduleNextRun')}</dt><dd>{formatDateTime(task.nextRunAt, t('scheduleNotScheduled'))}</dd>
        </dl>
        <div className={styles.detailTabs}>
          <button type="button" aria-pressed={tab === 'result'} onClick={() => setTab('result')}>{t('scheduleLastResult')}</button>
          <button type="button" aria-pressed={tab === 'config'} onClick={() => setTab('config')}>{t('scheduleTaskConfiguration')}</button>
        </div>
        {tab === 'result' ? (
          <div className={styles.result}>{task.lastMessage || t('scheduleNoResult')}</div>
        ) : (
          <>
            <dl className={styles.metadata}>
              <dt>{t('scheduleWorkspace')}</dt><dd>{task.workspaceRoot || t('scheduleWorkspacePlaceholder')}</dd>
              <dt>{t('scheduleModel')}</dt><dd>{props.modelLabel}</dd>
              {task.schedule.timeZone ? <><dt>{t('scheduleTimeZone')}</dt><dd>{task.schedule.timeZone}</dd></> : null}
              {props.clawLabel ? <><dt>{t('scheduleClientModeIm')}</dt><dd>{props.clawLabel}</dd></> : null}
            </dl>
            <h3 className="mb-2 text-[12px] font-semibold text-ds-ink">{t('scheduleTaskPrompt')}</h3>
            <div className={styles.result}>{task.prompt}</div>
          </>
        )}
        {threadId && props.onOpenThread ? (
          <button type="button" className={`${styles.button} mt-4`} onClick={() => props.onOpenThread?.(threadId)}><MessageSquare size={14} />{t('scheduleOpenLastThread')}</button>
        ) : null}
      </div>
      <footer className={styles.panelFooter}>
        <button type="button" className={`${styles.button} ${styles.danger}`} disabled={pending} onClick={props.onDelete}><Trash2 size={14} />{t('scheduleDeleteTask')}</button>
        <div className="flex items-center gap-2 text-[12px] text-ds-muted">
          {t('scheduleFilter_enabled')}
          <button type="button" role="switch" aria-checked={task.enabled} aria-label={t('scheduleToggleTask', { name: task.title })}
            className={styles.switch} disabled={pending} onClick={props.onToggle}><span /></button>
        </div>
      </footer>
    </aside>
  )
  return modal ? createPortal(
    <div className={`ds-no-drag ${styles.backdrop}`} onPointerDown={(event) => {
      if (event.target === event.currentTarget) props.onClose()
    }}>{content}</div>, document.body
  ) : content
}
