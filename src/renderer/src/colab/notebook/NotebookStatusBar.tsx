import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { COLAB_ACCELERATOR_SPECS } from '@shared/colab/colab-types'
import { formatColabDuration } from '../colab-store'
import { isLocalJupyterUrl } from './JupyterRuntimeSection'
import { useColabNotebookStore } from './colab-notebook-store'
import { useColabPortForwardStore } from './colab-port-forward-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Bottom status bar across the Notebook stage showing kernel state, queue, session CU, shortcuts, and save time. */
export function NotebookStatusBar({
  runtime,
  busy
}: {
  runtime: ColabNotebookRuntime
  busy: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const activePath = useColabNotebookStore((s) => s.activePath)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const saving = useColabNotebookStore((s) => s.saving)
  const lastSavedAt = useColabNotebookStore((s) => s.lastSavedAt)
  const queueLength = useColabNotebookStore((s) => s.queue.length)
  const setSidePanelTab = useColabNotebookStore((s) => s.setSidePanelTab)
  const setKernelPickerOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)
  const activeForwardsCount = useColabPortForwardStore(
    (s) =>
      s.forwards.filter(
        (item) => item.sessionId === runtime.session?.id && item.state !== 'failed'
      ).length
  )

  const sessionId = runtime.activeSessionId
  const usingJupyter = Boolean(
    sessionId && runtime.jupyterSession && sessionId === runtime.jupyterSession.id
  )
  const connecting = Boolean(runtime.pending || runtime.connecting || runtime.jupyterConnecting)

  const stateInfo = sessionId
    ? {
        dot: busy ? 'animate-pulse bg-amber-500' : 'bg-emerald-500',
        label: t(busy ? 'colabNb.statusKernelBusy' : 'colabNb.statusKernelIdle')
      }
    : connecting
      ? { dot: 'animate-pulse bg-amber-500', label: t('colabNb.kernelConnecting') }
      : { dot: 'bg-ds-faint', label: t('colabNb.kernelOffline') }

  const runtimeDetail =
    usingJupyter && runtime.jupyterSession
      ? `${t(
          isLocalJupyterUrl(runtime.jupyterSession.baseUrl)
            ? 'colabNb.jupyterLocalBadge'
            : 'colabNb.jupyterRemoteBadge'
        )} · ${runtime.jupyterSession.serverName} · ${runtime.jupyterSession.kernelName}`
      : sessionId && runtime.session
        ? t('colabNb.statusColabDetail', {
            gpu: COLAB_ACCELERATOR_SPECS[runtime.session.accelerator].fullLabel
          })
        : null

  const sessionCu =
    !usingJupyter && runtime.session && runtime.session.consumedCu > 0
      ? t('colabNb.statusSessionCu', { cu: runtime.session.consumedCu.toFixed(1) })
      : null

  const remainingSec =
    !usingJupyter && runtime.session && runtime.session.maxRuntimeHours > 0
      ? Math.max(0, Math.round(runtime.session.maxRuntimeHours * 3600 - runtime.session.elapsedSeconds))
      : null

  const saveStatus = !activePath
    ? null
    : saving
      ? { text: t('colabNb.saving'), tone: 'text-ds-faint' }
      : dirty
        ? { text: t('colabNb.statusUnsavedChanges'), tone: 'text-amber-600 dark:text-amber-400' }
        : lastSavedAt
          ? {
              text: t('colabNb.statusAutosavedAt', { time: formatClock(lastSavedAt) }),
              tone: 'text-ds-faint'
            }
          : { text: t('colabNb.saved'), tone: 'text-ds-faint' }

  return (
    <footer
      data-colab-status-bar
      className="ds-no-drag flex h-7 shrink-0 items-center gap-3.5 border-t border-ds-border-muted bg-ds-surface-subtle/60 px-3.5 text-[11.5px] text-ds-muted"
    >
      <button
        type="button"
        onClick={() => setKernelPickerOpen(true, { backend: usingJupyter ? 'jupyter' : undefined })}
        className="inline-flex shrink-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-ds-hover hover:text-ds-ink"
      >
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${stateInfo.dot}`} />
        <span>{stateInfo.label}</span>
      </button>

      {!sessionId && !connecting ? (
        <button
          type="button"
          onClick={() => setKernelPickerOpen(true)}
          className="shrink-0 rounded px-1 py-0.5 font-medium text-accent hover:bg-accent-tint/10"
        >
          {t('colabNb.statusConnectAction')}
        </button>
      ) : null}

      {runtimeDetail ? (
        <button
          type="button"
          onClick={() =>
            setKernelPickerOpen(true, { backend: usingJupyter ? 'jupyter' : 'colab' })
          }
          className="min-w-0 truncate rounded px-1 py-0.5 hover:bg-ds-hover hover:text-ds-ink"
        >
          {runtimeDetail}
        </button>
      ) : null}

      {queueLength > 0 ? (
        <span className="shrink-0 text-ds-muted">
          {t('colabNb.queuedCount', { count: queueLength })}
        </span>
      ) : null}

      {sessionCu ? <span className="shrink-0 font-mono">{sessionCu}</span> : null}

      {remainingSec !== null ? (
        <span className="hidden shrink-0 font-mono text-ds-faint sm:inline">
          {t('colabNb.autoStopRemaining', { time: formatColabDuration(remainingSec) })}
        </span>
      ) : null}

      {!usingJupyter && activeForwardsCount > 0 ? (
        <button
          type="button"
          onClick={() => setSidePanelTab('ports')}
          className="shrink-0 rounded px-1.5 py-0.5 font-medium text-accent hover:bg-accent-tint/10"
        >
          {t('colabNb.statusForwardsCount', { count: activeForwardsCount })}
        </button>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-3.5">
        {activePath ? (
          <span className="hidden text-ds-faint lg:inline">
            {t('colabNb.toolbarShortcutsHint')}
          </span>
        ) : null}
        {saveStatus ? <span className={saveStatus.tone}>{saveStatus.text}</span> : null}
      </div>
    </footer>
  )
}
