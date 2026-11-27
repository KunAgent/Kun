import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, ChevronRight, Loader2, X } from 'lucide-react'
import { COLAB_ACCELERATOR_SPECS } from '@shared/colab/colab-types'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { useColabStore } from '../colab-store'
import { useColabNotebookStore } from './colab-notebook-store'
import {
  DriveAuthorization,
  DrivePreparation,
  pullPrimaryBtn,
  pullSecondaryBtn,
  pullSupporting,
  pullSurface
} from './NotebookPullDriveAccess'
import { PullEntries, PullResults } from './NotebookPullEntries'
import { useNotebookPullStore, type NotebookPullTask } from './notebook-pull-store'

function PullSteps({ task }: { task: NotebookPullTask }): ReactElement {
  const { t } = useTranslation('common')
  const step = task.phase === 'result' ? 2 : ['select', 'importing'].includes(task.phase) ? 1 : 0
  const labels = [
    t('colabNb.pullPrepareStep'),
    t('colabNb.pullChooseStep'),
    t('colabNb.pullResultStep')
  ]
  return (
    <ol
      className="flex flex-wrap items-center gap-1.5 border-b border-ds-border px-5 pb-3.5 text-[12.5px]"
      aria-label={t('colabNb.pullTitle')}
    >
      {labels.map((label, index) => {
        const done = index < step
        const current = index === step
        return (
          <li key={label} className="inline-flex items-center gap-1.5">
            {index > 0 ? (
              <ChevronRight className="h-3.5 w-3.5 text-ds-faint" aria-hidden="true" />
            ) : null}
            <span
              aria-current={current ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 ${
                current ? 'bg-accent/10 font-semibold text-accent' : 'text-ds-muted'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : current
                      ? 'bg-accent text-white'
                      : 'bg-ds-hover text-ds-muted'
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span>{label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function NotebookPullView({
  task,
  workspaceRoot,
  onConfigureExecution
}: {
  task: NotebookPullTask
  workspaceRoot: string
  onConfigureExecution: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const otherSourceRequested = useNotebookPullStore((s) => s.otherSourceRequested)
  const connections = useColabStore((s) => s.snapshot.connections)
  const { phase, progress, cleanup, source } = task
  const project = workspaceLabelFromPath(task.workspaceRoot)
  const drive = source.kind === 'drive'
  const driveAccountLabel =
    source.kind === 'drive'
      ? (connections.find((c) => c.id === source.connectionId)?.email ?? source.label)
      : source.label
  const matchingProject = task.workspaceRoot === workspaceRoot
  const releasing = phase === 'closing' || cleanup === 'stopping'
  const title = t(drive ? 'colabNb.importModalDriveTitle' : 'colabNb.importModalJupyterTitle')
  const close = (): void => {
    void useNotebookPullStore.getState().close()
  }

  const dismissModal = (): void => {
    if (releasing) return
    if (phase === 'importing' || (!task.access?.temporary && phase === 'select')) {
      useNotebookPullStore.getState().hide()
      return
    }
    close()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      dismissModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div
      className="ds-no-drag absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissModal()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-notebook-pull-page={phase}
        className="flex max-h-[calc(100%-24px)] w-full max-w-[720px] flex-col overflow-hidden rounded-[16px] border border-ds-border bg-ds-card shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16.5px] font-bold tracking-tight text-ds-ink">{title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ds-muted">
              <strong className="font-medium text-ds-ink">
                {task.source.label} · {drive ? t('colabNb.pullMyDrive') : 'Jupyter'}
              </strong>
              <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0 text-ds-faint" />
              <span>{t('colabNb.importModalProject')}</span>
              <strong className="font-semibold text-ds-ink" title={task.workspaceRoot}>
                {project}
              </strong>
              <span className="text-ds-faint">·</span>
              <span>{t('colabNb.importModalCopyOnly')}</span>
            </div>
          </div>
          <button
            type="button"
            disabled={releasing}
            aria-label={t('cancel')}
            title={t('cancel')}
            onClick={dismissModal}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <PullSteps task={task} />

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {otherSourceRequested ? (
            <p role="status" className={`${pullSurface} ${pullSupporting}`}>
              {t('colabNb.pullFinishCurrent')}
            </p>
          ) : null}
          {!matchingProject ? (
            <p role="status" className={pullSupporting}>
              {t('colabNb.pullProjectChanged')}
            </p>
          ) : null}
          {matchingProject && phase === 'prepare' && drive ? (
            <DrivePreparation task={task} onConfigureExecution={onConfigureExecution} />
          ) : null}
          {matchingProject && phase === 'auth' ? <DriveAuthorization task={task} /> : null}
          {matchingProject && phase === 'select' ? <PullEntries task={task} /> : null}
          {phase === 'result' ? <PullResults task={task} allowOpen={matchingProject} /> : null}
          {phase === 'reading' || phase === 'closing' ? (
            <div className={`${pullSurface} flex items-center gap-3`} role="status">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
              <div>
                <p className="text-[13px] font-medium text-ds-ink">
                  {t(phase === 'closing' ? 'colabNb.pullClosing' : 'colabNb.driveLoading')}
                </p>
                {phase === 'reading' ? (
                  <p className={pullSupporting}>{t('colabNb.pullReadingHint')}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          {phase === 'importing' && progress ? (
            <div className={`${pullSurface} space-y-2`}>
              <p className="text-[13px] font-medium text-ds-ink" role="status">
                {t('colabNb.pullProgress', progress)}
              </p>
              <progress
                aria-label={title}
                className="h-2 w-full accent-accent"
                max={progress.total}
                value={progress.completed}
              />
            </div>
          ) : null}
          {phase === 'error' ? (
            <p
              role="alert"
              className={`${pullSurface} break-words text-[13px] text-amber-700 dark:text-amber-300`}
            >
              {task.error?.kind === 'account_mismatch'
                ? t('colabNb.driveMountAccountMismatch', { account: driveAccountLabel })
                : t(
                    task.error?.kind === 'auth_expired'
                      ? 'colabNb.pullAuthExpired'
                      : task.error?.kind === 'interrupted'
                        ? 'colabNb.pullInterrupted'
                        : 'colabNb.pullFailed'
                  )}
              {task.error?.message && !task.error.kind ? (
                <span className="mt-1 block text-[12px] text-ds-muted">{task.error.message}</span>
              ) : null}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-ds-border bg-ds-subtle/60 px-5 py-3">
          <span
            role={cleanup ? 'status' : undefined}
            className={`min-w-0 flex-1 text-[11.5px] ${
              cleanup === 'failed' ? 'text-amber-700 dark:text-amber-300' : 'text-ds-muted'
            }`}
          >
            {cleanup
              ? t(`colabNb.pullCleanup.${cleanup}`)
              : drive
                ? t('colabNb.pullTempFooterNote', {
                    cu: COLAB_ACCELERATOR_SPECS.CPU.estimatedCuPerHour
                  })
                : t('colabNb.pullKernelUnchanged')}
          </span>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" className={pullSecondaryBtn} disabled={releasing} onClick={close}>
              {t(
                cleanup === 'failed'
                  ? 'colabNb.pullRetryStop'
                  : phase === 'result'
                    ? 'colabNb.pullDoneClose'
                    : 'cancel'
              )}
            </button>
            {matchingProject && phase === 'error' && !releasing && cleanup !== 'failed' ? (
              <button
                type="button"
                className={pullPrimaryBtn}
                onClick={() => void useNotebookPullStore.getState().refresh()}
              >
                {t(drive ? 'colabNb.pullPrepareAgain' : 'colabNb.refresh')}
              </button>
            ) : null}
            {matchingProject && phase === 'select' ? (
              task.entries.length > 0 ? (
                <button
                  type="button"
                  className={pullPrimaryBtn}
                  disabled={!task.picked.length}
                  onClick={() => void useNotebookPullStore.getState().pullPicked()}
                >
                  {t('colabNb.pullImportSelected', { total: task.picked.length })}
                </button>
              ) : (
                <button
                  type="button"
                  className={pullSecondaryBtn}
                  disabled={releasing}
                  onClick={async () => {
                    await useNotebookPullStore.getState().close()
                    const notebook = useColabNotebookStore.getState()
                    if (
                      notebook.workspaceRoot === task.workspaceRoot &&
                      !useNotebookPullStore.getState().task
                    ) {
                      await notebook.importLocalNotebooks(task.workspaceRoot)
                    }
                  }}
                >
                  {t('colabNb.importLocalBtn')}
                </button>
              )
            ) : null}
            {matchingProject &&
            phase === 'result' &&
            task.failed.length > 0 &&
            cleanup !== 'failed' ? (
              <button
                type="button"
                className={pullPrimaryBtn}
                disabled={releasing}
                onClick={() => void useNotebookPullStore.getState().retryFailed()}
              >
                {t('colabNb.pullRetry', { total: task.failed.length })}
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  )
}
