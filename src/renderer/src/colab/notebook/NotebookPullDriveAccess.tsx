import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { COLAB_NOTEBOOK_ENTRY_COMMAND } from '@shared/colab/colab-notebook-types'
import { COLAB_ACCELERATOR_SPECS } from '@shared/colab/colab-types'
import { selectWorkspaceSessions, useColabStore } from '../colab-store'
import { useNotebookPullStore, type NotebookPullTask } from './notebook-pull-store'

export const pullSecondaryBtn =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45'
export const pullPrimaryBtn =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-accent px-3.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-45'
export const pullSurface = 'rounded-xl border border-ds-border bg-ds-main/50 p-4'
export const pullSupporting = 'text-[12px] leading-relaxed text-ds-muted'

export function DrivePreparation({
  task,
  onConfigureExecution
}: {
  task: NotebookPullTask
  onConfigureExecution: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const connectionId = task.source.kind === 'drive' ? task.source.connectionId : null
  const account = snapshot.connections.find((item) => item.id === connectionId)
  const available = selectWorkspaceSessions(snapshot, task.workspaceRoot).find(
    (session) =>
      session.connectionId === connectionId &&
      session.phase === 'running' &&
      session.entryCommand === COLAB_NOTEBOOK_ENTRY_COMMAND
  )

  return (
    <div className="space-y-3">
      {snapshot.connections.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {snapshot.connections.map((conn) => {
            const active = conn.id === connectionId
            return (
              <button
                key={conn.id}
                type="button"
                disabled={Boolean(task.access)}
                onClick={() => useNotebookPullStore.getState().setDriveAccount(conn.id, conn.name)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${
                  active
                    ? 'border-accent bg-accent/10 font-semibold text-accent'
                    : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
              >
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9.5px] font-bold text-white"
                  style={{ backgroundColor: conn.avatarColor }}
                >
                  {conn.name.slice(0, 1).toUpperCase()}
                </span>
                <span>{conn.name}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {!account || account.status !== 'connected' ? (
        <div className={pullSurface} role="status">
          <p className={pullSupporting}>{t('colabNb.pullSignInAgain')}</p>
          <button
            type="button"
            className={`${pullSecondaryBtn} mt-3`}
            onClick={() => {
              useNotebookPullStore.getState().hide()
              onConfigureExecution()
            }}
          >
            {t('colabNb.accountsAndConnections')}
          </button>
        </div>
      ) : (
        <div className={`${pullSurface} space-y-3`}>
          <h3 className="text-[14px] font-semibold text-ds-ink">
            {t(available ? 'colabNb.pullReuseTitle' : 'colabNb.pullTempTitle')}
          </h3>
          <p className={pullSupporting}>
            {t(available ? 'colabNb.pullReuseHint' : 'colabNb.pullTempHint')}
          </p>
          <dl className="space-y-1.5 rounded-lg bg-ds-subtle px-3 py-2.5 text-[12px]">
            {available ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-ds-muted">{t('colabNb.runtime')}</dt>
                <dd className="min-w-0 break-words font-medium text-ds-ink">
                  {available.sessionName} · {available.accelerator} ·{' '}
                  {t('colabNb.pullCuRate', { cu: available.burnRateCuPerHour })}
                </dd>
              </div>
            ) : (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-ds-muted">{t('colabNb.pullEstimate')}</dt>
                <dd className="font-medium text-ds-ink">
                  {t('colabNb.pullCuRate', { cu: COLAB_ACCELERATOR_SPECS.CPU.estimatedCuPerHour })}
                </dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            className={pullPrimaryBtn}
            disabled={
              Boolean(task.access) || task.cleanup === 'stopping' || task.cleanup === 'failed'
            }
            onClick={() =>
              void useNotebookPullStore
                .getState()
                .startDrive(available ? { sessionId: available.id } : { temporaryCpu: true })
            }
          >
            {t(available ? 'colabNb.pullReuseAction' : 'colabNb.pullStartTemporary')}
          </button>
        </div>
      )}
    </div>
  )
}

export function DriveAuthorization({ task }: { task: NotebookPullTask }): ReactElement {
  const { t } = useTranslation('common')
  const account = useColabStore((s) => s.snapshot.connections).find(
    (item) => task.source.kind === 'drive' && item.id === task.source.connectionId
  )
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
    <div className={`${pullSurface} space-y-3`}>
      <h3 className="text-[14px] font-semibold text-ds-ink">{t('colabNb.pullAuthorizeTitle')}</h3>
      <p className={pullSupporting}>
        {t('colabNb.pullAuthorizeHint', { account: account?.email ?? task.source.label })}
      </p>
      {task.access?.temporary ? (
        <p className="text-[12px] text-amber-700 dark:text-amber-300">
          {t('colabNb.pullTempBilling')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={pullPrimaryBtn}
          onClick={() => void useNotebookPullStore.getState().completeAuth()}
        >
          {t('colabNb.pullVerifyAuth')}
        </button>
        <button
          type="button"
          className={pullSecondaryBtn}
          onClick={async () => {
            const opened = await useNotebookPullStore.getState().reopenAuth()
            setNotice(opened ? null : 'openError')
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {t('colabNb.driveAuthOpenBrowser')}
        </button>
        <button type="button" className={pullSecondaryBtn} onClick={() => void copy()}>
          {t('colabNb.driveAuthCopyLink')}
        </button>
      </div>
      {notice ? (
        <p role="status" className={pullSupporting}>
          {t(`colabNb.pullAuthNotice.${notice}`)}
        </p>
      ) : null}
    </div>
  )
}
