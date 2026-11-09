import { useEffect, useId, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ScheduledTaskV1 } from '@shared/app-settings'
import { useSchedulePanelFocus } from './use-schedule-panel-focus'
import styles from './ScheduleTaskBrowser.module.css'

export function ScheduleTasksDeleteConfirm({ tasks, busyCount, pending, error, onCancel, onConfirm }: {
  tasks: ScheduledTaskV1[]
  busyCount: number
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const panel = useRef<HTMLElement | null>(null)
  const id = useId()
  useSchedulePanelFocus(panel, () => { if (!pending) onCancel() }, true)
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [])
  return createPortal(
    <div className={`ds-no-drag ${styles.confirmBackdrop}`}>
      <section ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className={styles.confirm}>
        <h2 id={`${id}-title`}>{t('scheduleDeleteSelectedTitle', { count: tasks.length })}</h2>
        <p id={`${id}-description`}>{t('scheduleDeleteSelectedDescription')}</p>
        <ul>{tasks.slice(0, 3).map((task) => <li key={task.id}>{task.title || t('scheduleUntitled')}</li>)}
          {tasks.length > 3 ? <li>{t('scheduleAndMore', { total: tasks.length - 3 })}</li> : null}
        </ul>
        {busyCount > 0 ? <p>{t('scheduleDeleteBusyNotice', { total: busyCount })}</p> : null}
        {error ? <p role="alert" className={styles.danger}>{error}</p> : null}
        <footer>
          <button type="button" className={styles.button} disabled={pending} onClick={onCancel}>{t('cancel')}</button>
          <button type="button" className={`${styles.button} ${styles.danger}`} disabled={pending} onClick={onConfirm}>{t(pending ? 'saving' : 'scheduleDeleteSelectedButton', { count: tasks.length })}</button>
        </footer>
      </section>
    </div>, document.body
  )
}
