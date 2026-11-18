import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Check, CloudDownload, ExternalLink, Loader2, Search } from 'lucide-react'
import {
  COLAB_NOTEBOOK_ENTRY_COMMAND,
  NOTEBOOK_IMPORT_MAX_BYTES,
  NOTEBOOK_PULL_MAX_FILES,
  type ColabDriveNotebookEntry
} from '@shared/colab/colab-notebook-types'
import { COLAB_ACCELERATOR_SPECS } from '@shared/colab/colab-types'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { formatColabBytes, selectWorkspaceSessions, useColabStore } from '../colab-store'
import { useColabNotebookStore } from './colab-notebook-store'
import { canPullEntry, filterPullEntries, useNotebookPullStore, type NotebookPullTask } from './notebook-pull-store'

const secondary = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45'
const primary = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-45'
const surface = 'rounded-xl border border-ds-border bg-ds-card p-4'
const supporting = 'text-[12px] leading-relaxed text-ds-muted'

function PullSteps({ task }: { task: NotebookPullTask }): ReactElement {
  const { t } = useTranslation('common')
  const step = task.phase === 'result' ? 2 : ['select', 'importing'].includes(task.phase) ? 1 : 0
  const labels = [t('colabNb.pullPrepareStep'), t('colabNb.pullChooseStep'), t('colabNb.pullResultStep')]
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-2 border-b border-ds-border pb-3 text-[12px]" aria-label={t('colabNb.pullTitle')}>
      {labels.map((label, index) => (
        <li key={label} aria-current={index === step ? 'step' : undefined}
          className={`inline-flex items-center gap-1.5 ${index === step ? 'font-semibold text-accent' : 'text-ds-muted'}`}>
          <span aria-hidden="true" className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ds-hover">
            {index < step ? <Check className="h-3 w-3 text-emerald-600" /> : index + 1}
          </span>{label}
        </li>
      ))}
    </ol>
  )
}

function DrivePreparation({ task, onConfigureExecution }: { task: NotebookPullTask; onConfigureExecution: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const connectionId = task.source.kind === 'drive' ? task.source.connectionId : null
  const account = snapshot.connections.find((item) => item.id === connectionId)
  const available = selectWorkspaceSessions(snapshot, task.workspaceRoot).find((session) =>
    session.connectionId === connectionId && session.phase === 'running' && session.entryCommand === COLAB_NOTEBOOK_ENTRY_COMMAND)
  if (!account || account.status !== 'connected') {
    return (
      <div className={surface} role="status">
        <p className={supporting}>{t('colabNb.pullSignInAgain')}</p>
        <button type="button" className={`${secondary} mt-3`} onClick={onConfigureExecution}>
          {t('colabNb.accountsAndConnections')}
        </button>
      </div>
    )
  }
  return (
    <div className={`${surface} space-y-3`}>
      <h3 className="font-semibold text-ds-ink">{t(available ? 'colabNb.pullReuseTitle' : 'colabNb.pullTempTitle')}</h3>
      <p className={supporting}>{t(available ? 'colabNb.pullReuseHint' : 'colabNb.pullTempHint')}</p>
      <dl className="space-y-1.5 rounded-lg bg-ds-subtle p-3 text-[12px]">
        {available ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ds-muted">{t('colabNb.runtime')}</dt>
            <dd className="min-w-0 break-words font-medium text-ds-ink">
              {available.sessionName} · {available.accelerator} · {t('colabNb.pullCuRate', { cu: available.burnRateCuPerHour })}
            </dd>
          </div>
        ) : (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ds-muted">{t('colabNb.pullEstimate')}</dt>
            <dd className="font-medium text-ds-ink">{t('colabNb.pullCuRate', { cu: COLAB_ACCELERATOR_SPECS.CPU.estimatedCuPerHour })}</dd>
          </div>
        )}
      </dl>
      <button type="button" className={primary} disabled={Boolean(task.access) || task.cleanup === 'stopping' || task.cleanup === 'failed'}
        onClick={() => void useNotebookPullStore.getState().startDrive(available ? { sessionId: available.id } : { temporaryCpu: true })}>
        {t(available ? 'colabNb.pullReuseAction' : 'colabNb.pullStartTemporary')}
      </button>
    </div>
  )
}

function DriveAuthorization({ task }: { task: NotebookPullTask }): ReactElement {
  const { t } = useTranslation('common')
  const account = useColabStore((s) => s.snapshot.connections).find((item) => task.source.kind === 'drive' && item.id === task.source.connectionId)
  const [notice, setNotice] = useState<'copied' | 'copyError' | 'openError' | null>(null)
  const copy = async (): Promise<void> => {
    try {
      if (!task.auth) return
      await navigator.clipboard.writeText(task.auth.url)
      setNotice('copied')
    } catch {
      setNotice('copyError')
    }
  }
  return (
    <div className={`${surface} space-y-3`}>
      <h3 className="font-semibold text-ds-ink">{t('colabNb.pullAuthorizeTitle')}</h3>
      <p className={supporting}>{t('colabNb.pullAuthorizeHint', { account: account?.email ?? task.source.label })}</p>
      {task.access?.temporary ? <p className="text-[12px] text-amber-700 dark:text-amber-300">{t('colabNb.pullTempBilling')}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => void useNotebookPullStore.getState().completeAuth()}>{t('colabNb.pullVerifyAuth')}</button>
        <button type="button" className={secondary} onClick={async () => {
          const opened = await useNotebookPullStore.getState().reopenAuth()
          setNotice(opened ? null : 'openError')
        }}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('colabNb.driveAuthOpenBrowser')}</button>
        <button type="button" className={secondary} onClick={() => void copy()}>{t('colabNb.driveAuthCopyLink')}</button>
      </div>
      {notice ? <p role="status" className={supporting}>{t(`colabNb.pullAuthNotice.${notice}`)}</p> : null}
    </div>
  )
}

function PullEntries({ task }: { task: NotebookPullTask }): ReactElement {
  const { t } = useTranslation('common')
  const notebooks = useColabNotebookStore((s) => s.notebooks)
  const visible = useMemo(() => filterPullEntries(task.entries, task.query), [task.entries, task.query])
  const picked = new Set(task.picked)
  const saved = new Set(task.saved.map((file) => file.remotePath))
  const local = new Set(notebooks.map((path) => path.toLocaleLowerCase()))
  const isSelectable = (entry: ColabDriveNotebookEntry): boolean => canPullEntry(entry) && !saved.has(entry.remotePath)
  const paths = visible.filter(isSelectable).map((entry) => entry.remotePath)
  const allVisiblePicked = paths.length > 0 && paths.every((path) => picked.has(path))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-2.5 text-ds-muted focus-within:border-accent">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input type="search" aria-label={t('colabNb.driveSearchPlaceholder')} placeholder={t('colabNb.driveSearchPlaceholder')}
            value={task.query} onChange={(event) => useNotebookPullStore.getState().setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-2 text-[12.5px] text-ds-ink outline-none" />
        </label>
        <button type="button" className={secondary} onClick={() => void useNotebookPullStore.getState().refresh()}>{t('colabNb.refresh')}</button>
      </div>
      {visible.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-ds-border bg-ds-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-border bg-ds-subtle px-3 py-2 text-[11.5px] text-ds-muted">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allVisiblePicked} disabled={paths.length === 0} className="accent-accent"
                ref={(node) => { if (node) node.indeterminate = !allVisiblePicked && paths.some((path) => picked.has(path)) }}
                onChange={(event) => useNotebookPullStore.getState().setPicked(paths, event.target.checked)} />
              {t('colabNb.pullSelectVisible')}
            </label>
            <span>{t('colabNb.driveCount', { total: visible.length })}</span>
          </div>
          <ul className="divide-y divide-ds-border/70">
            {visible.map((entry) => {
              const inBatch = saved.has(entry.remotePath)
              const tooBig = !canPullEntry(entry)
              const sameName = local.has(entry.name.toLocaleLowerCase())
              const folder = entry.relativePath.split('/').slice(0, -1).join('/') || (task.source.kind === 'drive' ? t('colabNb.pullMyDrive') : '/')
              return (
                <li key={entry.remotePath}>
                  <label className={`flex items-center gap-2.5 px-3 py-2.5 ${isSelectable(entry) ? 'cursor-pointer hover:bg-ds-hover' : 'opacity-65'}`}>
                    <input type="checkbox" className="shrink-0 accent-accent" disabled={!isSelectable(entry)} checked={picked.has(entry.remotePath)}
                      aria-label={entry.relativePath} onChange={(event) => useNotebookPullStore.getState().setPicked([entry.remotePath], event.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-ds-ink" title={entry.name}>{entry.name}</span>
                      <span className="block truncate text-[11px] text-ds-muted" title={entry.relativePath}>{folder}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-ds-muted">
                      {entry.sizeBytes < 0 ? '—' : formatColabBytes(entry.sizeBytes)}
                    </span>
                    {inBatch || tooBig || sameName ? (
                      <span className="max-w-[31%] text-right text-[11px] leading-tight text-amber-700 dark:text-amber-300">
                        {inBatch ? t('colabNb.pullAlreadySaved') : tooBig ? t('colabNb.pullTooLarge', { size: formatColabBytes(NOTEBOOK_IMPORT_MAX_BYTES) }) : t('colabNb.pullSameName')}
                      </span>
                    ) : null}
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className={surface} role="status">
          <p className="text-[13px] font-semibold text-ds-ink">{t(task.entries.length ? 'colabNb.pullNoMatches' : 'colabNb.driveEmpty')}</p>
          {!task.entries.length && task.source.kind === 'drive' ? <p className={`${supporting} mt-1`}>{t('colabNb.pullEmptyDriveHint')}</p> : null}
        </div>
      )}
      <p className={supporting}>{t('colabNb.pullCopyPolicy', { total: NOTEBOOK_PULL_MAX_FILES })}</p>
    </div>
  )
}

function PullResults({ task, allowOpen }: { task: NotebookPullTask; allowOpen: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const kunBusy = useColabNotebookStore((s) => s.kunBusy)
  return (
    <div className="space-y-3">
      <h3 role="status" className="text-[14px] font-semibold text-ds-ink">
        {t(task.failed.length ? 'colabNb.pullPartial' : 'colabNb.pullDone', { saved: task.saved.length, failed: task.failed.length })}
      </h3>
      <ul className="space-y-1.5">
        {task.saved.map((file) => (
          <li key={file.remotePath} className="flex flex-wrap items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 py-2.5">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-[13px] font-medium text-ds-ink">{file.relativePath}</p>
              <p className={supporting}>{t(`colabNb.pullDisposition.${file.disposition}`)}</p>
            </div>
            <button type="button" className={secondary} disabled={!allowOpen || kunBusy} onClick={() => {
              if (useColabNotebookStore.getState().workspaceRoot !== task.workspaceRoot) return
              useNotebookPullStore.getState().hide()
              void useColabNotebookStore.getState().openNotebook(file.relativePath)
            }}>{t('colabNb.pullOpenCopy')}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </li>
        ))}
        {task.failed.map(({ entry, message }) => (
          <li key={entry.remotePath} className="rounded-lg border border-amber-500/40 bg-ds-card px-3 py-2.5">
            <p className="break-words text-[13px] font-medium text-ds-ink">{entry.relativePath}</p>
            <p className="break-words text-[12px] text-amber-700 dark:text-amber-300">{message ?? t('colabNb.pullFileFailed')}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function NotebookPullView({ task, workspaceRoot, onConfigureExecution }: {
  task: NotebookPullTask
  workspaceRoot: string
  onConfigureExecution: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const otherSourceRequested = useNotebookPullStore((s) => s.otherSourceRequested)
  const { phase, progress, cleanup } = task
  const project = workspaceLabelFromPath(task.workspaceRoot)
  const drive = task.source.kind === 'drive'
  const matchingProject = task.workspaceRoot === workspaceRoot
  const releasing = phase === 'closing' || cleanup === 'stopping'
  const title = t(drive ? 'colabNb.pullFromDrive' : 'colabNb.jupyterBrowseNotebooks')
  const close = (): void => { void useNotebookPullStore.getState().close() }
  return (
    <section data-notebook-pull-page={phase} className="ds-no-drag flex min-h-0 flex-1 flex-col" aria-label={title}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ds-border bg-ds-subtle px-3 py-2.5 text-[12px]">
            <span className="shrink-0 text-ds-muted">{t('colabNb.pullSource')}</span>
            <strong className="min-w-0 break-words text-ds-ink">{task.source.label} · {drive ? t('colabNb.pullMyDrive') : 'Jupyter'}</strong>
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
            <span className="shrink-0 text-ds-muted">{t('colabNb.pullDestination')}</span>
            <strong className="min-w-0 break-words text-ds-ink" title={task.workspaceRoot}>{project}</strong>
          </div>
          <div>
            <h2 className="text-[21px] font-semibold tracking-tight text-ds-ink">{title}</h2>
            <p className={`${supporting} mt-1`}>{t('colabNb.pullKernelUnchanged')}</p>
          </div>
          <PullSteps task={task} />
          {otherSourceRequested ? <p role="status" className={`${surface} ${supporting}`}>{t('colabNb.pullFinishCurrent')}</p> : null}
          {!matchingProject ? <p role="status" className={supporting}>{t('colabNb.pullProjectChanged')}</p> : null}
          {matchingProject && phase === 'prepare' && drive ? <DrivePreparation task={task} onConfigureExecution={onConfigureExecution} /> : null}
          {matchingProject && phase === 'auth' ? <DriveAuthorization task={task} /> : null}
          {matchingProject && phase === 'select' ? <PullEntries task={task} /> : null}
          {phase === 'result' ? <PullResults task={task} allowOpen={matchingProject} /> : null}
          {phase === 'reading' || phase === 'closing' ? (
            <div className={`${surface} flex items-center gap-3`} role="status">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
              <div>
                <p className="text-[13px] font-medium text-ds-ink">{t(phase === 'closing' ? 'colabNb.pullClosing' : 'colabNb.driveLoading')}</p>
                {phase === 'reading' ? <p className={supporting}>{t('colabNb.pullReadingHint')}</p> : null}
              </div>
            </div>
          ) : null}
          {phase === 'importing' && progress ? (
            <div className={`${surface} space-y-2`}>
              <p className="text-[13px] font-medium text-ds-ink" role="status">{t('colabNb.pullProgress', progress)}</p>
              <progress aria-label={title} className="h-2 w-full accent-accent" max={progress.total} value={progress.completed} />
            </div>
          ) : null}
          {phase === 'error' ? (
            <p role="alert" className={`${surface} break-words text-[13px] text-amber-700 dark:text-amber-300`}>
              {t(task.error?.kind === 'auth_expired' ? 'colabNb.pullAuthExpired' : task.error?.kind === 'interrupted' ? 'colabNb.pullInterrupted' : 'colabNb.pullFailed')}
              {task.error?.message && !task.error.kind ? <span className="mt-1 block text-[12px] text-ds-muted">{task.error.message}</span> : null}
            </p>
          ) : null}
          {cleanup ? (
            <p role="status" className={cleanup === 'failed' ? 'text-[12px] text-amber-700 dark:text-amber-300' : supporting}>
              {t(`colabNb.pullCleanup.${cleanup}`)}
            </p>
          ) : null}
        </div>
      </div>
      <footer className="border-t border-ds-border bg-ds-main px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[852px] flex-wrap items-center justify-between gap-2">
          <button type="button" className={secondary} onClick={() => useNotebookPullStore.getState().hide()}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{t('colabNb.pullBackToNotebook')}
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondary} disabled={releasing} onClick={close}>
              {t(cleanup === 'failed' ? 'colabNb.pullRetryStop' : phase === 'result' ? 'colabNb.pullFinish' : 'colabNb.pullCancel')}
            </button>
            {matchingProject && phase === 'error' && !releasing && cleanup !== 'failed' ? (
              <button type="button" className={primary} onClick={() => void useNotebookPullStore.getState().refresh()}>
                {t(drive ? 'colabNb.pullPrepareAgain' : 'colabNb.refresh')}
              </button>
            ) : null}
            {matchingProject && phase === 'select' ? (task.entries.length > 0 ? (
              <button type="button" className={primary} disabled={!task.picked.length} onClick={() => void useNotebookPullStore.getState().pullPicked()}>
                <CloudDownload className="h-3.5 w-3.5" aria-hidden="true" />{t('colabNb.pullSelected', { total: task.picked.length })}
              </button>
            ) : (
              <button type="button" className={secondary} disabled={releasing} onClick={async () => {
                await useNotebookPullStore.getState().close()
                const notebook = useColabNotebookStore.getState()
                if (notebook.workspaceRoot === task.workspaceRoot && !useNotebookPullStore.getState().task) {
                  await notebook.importLocalNotebooks(task.workspaceRoot)
                }
              }}>{t('colabNb.importLocalBtn')}</button>
            )) : null}
            {matchingProject && phase === 'result' && task.failed.length > 0 && cleanup !== 'failed' ? (
              <button type="button" className={primary} disabled={releasing} onClick={() => void useNotebookPullStore.getState().retryFailed()}>
                {t('colabNb.pullRetry', { total: task.failed.length })}
              </button>
            ) : null}
          </div>
        </div>
      </footer>
    </section>
  )
}
