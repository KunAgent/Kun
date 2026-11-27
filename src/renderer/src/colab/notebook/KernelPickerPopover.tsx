import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Cloud, Plug, Server } from 'lucide-react'
import { COLAB_ACCELERATOR_SPECS } from '@shared/colab/colab-types'
import type { NotebookRuntimeBackend } from '@shared/colab/colab-notebook-types'
import { useColabStore } from '../colab-store'
import { useColabDismiss } from '../use-colab-dismiss'
import { ColabKernelSection } from './ColabKernelSection'
import { isLocalJupyterUrl, JupyterRuntimeSection } from './JupyterRuntimeSection'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

export function KernelPickerPopover({
  runtime,
  busy
}: {
  runtime: ColabNotebookRuntime
  busy: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const open = useColabNotebookStore((s) => s.kernelPickerOpen)
  const initialAddJupyter = useColabNotebookStore((s) => s.kernelPickerInitialAddJupyter)
  const tabOverride = useColabNotebookStore((s) => s.kernelPickerTabOverride)
  const setOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)

  const snapshot = useColabStore((s) => s.snapshot)
  const connections = snapshot.connections
  const untracked = snapshot.untrackedSessions
  const colabLive = runtime.session ?? runtime.pending

  const usingJupyter = Boolean(
    runtime.activeSessionId &&
      runtime.jupyterSession &&
      runtime.activeSessionId === runtime.jupyterSession.id
  )

  const resolveDefaultTab = useCallback((): NotebookRuntimeBackend => {
    if (tabOverride) return tabOverride
    if (initialAddJupyter) return 'jupyter'
    if (usingJupyter || runtime.jupyterConnecting) return 'jupyter'
    if (colabLive || runtime.connecting) return 'colab'
    if (runtime.backend === 'jupyter') return 'jupyter'
    if (runtime.jupyterServers.length > 0 && connections.length === 0) return 'jupyter'
    if (connections.length > 0) return 'colab'
    return 'jupyter'
  }, [
    colabLive,
    connections.length,
    initialAddJupyter,
    runtime.backend,
    runtime.connecting,
    runtime.jupyterConnecting,
    runtime.jupyterServers.length,
    tabOverride,
    usingJupyter
  ])

  const [sourceTab, setSourceTab] = useState<NotebookRuntimeBackend>(resolveDefaultTab)

  useEffect(() => {
    if (open) setSourceTab(resolveDefaultTab())
  }, [open, resolveDefaultTab])

  const containerRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [setOpen])
  useColabDismiss(open, close, containerRef)

  const primaryConnectedLabel =
    usingJupyter && runtime.jupyterSession
      ? t(
          isLocalJupyterUrl(runtime.jupyterSession.baseUrl)
            ? 'colabNb.jupyterLocalBadge'
            : 'colabNb.jupyterRemoteBadge'
        )
      : runtime.session
        ? `Colab ${COLAB_ACCELERATOR_SPECS[runtime.session.accelerator].label}`
        : runtime.activeRuntimeLabel

  const secondaryConnectedLabel =
    usingJupyter && runtime.jupyterSession
      ? runtime.jupyterSession.kernelName
      : runtime.session
        ? 'Python 3'
        : null

  const isConnected = Boolean(runtime.activeSessionId && primaryConnectedLabel)
  const isConnecting = !isConnected && Boolean(runtime.pending || runtime.connecting || runtime.jupyterConnecting)

  const connectingLabel =
    runtime.pending?.provisioningMaxAttempts && runtime.pending.provisioningMaxAttempts > 1
      ? t('colabNb.provisioningAttempt', {
          attempt: runtime.pending.provisioningAttempt ?? 1,
          total: runtime.pending.provisioningMaxAttempts
        })
      : t('colabNb.kernelConnecting')

  return (
    <div ref={containerRef} className="ds-no-drag relative shrink-0">
      <button
        type="button"
        data-colab-kernel-picker-trigger
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-full border pl-2.5 pr-2 text-[12.5px] transition ${
          isConnected
            ? 'border-ds-border bg-ds-card font-medium text-ds-ink hover:bg-ds-hover'
            : isConnecting
              ? 'border-amber-500/30 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300'
              : open
                ? 'border-accent-tint/45 bg-accent-tint/15 font-medium text-accent ring-2 ring-accent-tint/20'
                : 'border-accent-tint/35 bg-accent-tint/[0.07] font-medium text-accent hover:bg-accent-tint/[0.12]'
        }`}
      >
        {isConnected ? (
          <>
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                busy ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'
              }`}
            />
            <span className="max-w-[140px] truncate">{primaryConnectedLabel}</span>
            {secondaryConnectedLabel ? (
              <span className="max-w-[90px] truncate text-[11.5px] font-normal text-ds-faint">
                {secondaryConnectedLabel}
              </span>
            ) : null}
          </>
        ) : isConnecting ? (
          <>
            <span className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-amber-500" />
            <span className="max-w-[180px] truncate">{connectingLabel}</span>
          </>
        ) : (
          <>
            <Plug className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="max-w-[160px] truncate">{t('colabNb.connectRuntimeBtn')}</span>
            {untracked.length > 0 ? (
              <span
                className="h-[6px] w-[6px] shrink-0 rounded-full bg-amber-500"
                title={t('colabNb.untrackedSectionTitle')}
              />
            ) : null}
          </>
        )}
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('colabNb.selectKernel')}
          data-colab-kernel-picker
          className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100vh-96px)] w-[430px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[14px] border border-ds-border bg-ds-card py-1.5 shadow-2xl"
        >
          <div className="px-2 pb-1.5 pt-1">
            <div
              role="tablist"
              data-colab-kernel-tabs
              aria-label={t('colabNb.selectKernel')}
              className="grid grid-cols-2 gap-1 rounded-[10px] bg-ds-main p-1"
            >
              <button
                type="button"
                role="tab"
                data-runtime-source="jupyter"
                aria-selected={sourceTab === 'jupyter'}
                onClick={() => setSourceTab('jupyter')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition ${
                  sourceTab === 'jupyter'
                    ? 'bg-ds-card font-semibold text-ds-ink shadow-sm'
                    : 'text-ds-muted hover:text-ds-ink'
                }`}
              >
                <Server className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t('colabNb.jupyterCustomTab')}</span>
                {runtime.jupyterSession ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                ) : runtime.jupyterServers.length > 0 ? (
                  <span className="rounded bg-ds-hover px-1 font-mono text-[10px] text-ds-muted">
                    {runtime.jupyterServers.length}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                data-runtime-source="colab"
                aria-selected={sourceTab === 'colab'}
                onClick={() => setSourceTab('colab')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition ${
                  sourceTab === 'colab'
                    ? 'bg-ds-card font-semibold text-ds-ink shadow-sm'
                    : 'text-ds-muted hover:text-ds-ink'
                }`}
              >
                <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Google Colab</span>
                {colabLive ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                ) : untracked.length > 0 ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    title={t('colabNb.untrackedSectionTitle')}
                  />
                ) : connections.length > 0 ? (
                  <span className="rounded bg-ds-hover px-1 font-mono text-[10px] text-ds-muted">
                    {connections.length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          {sourceTab === 'jupyter' ? (
            <JupyterRuntimeSection
              runtime={runtime}
              initialAdding={initialAddJupyter}
              onConnected={close}
            />
          ) : (
            <ColabKernelSection runtime={runtime} busy={busy} onClose={close} />
          )}
        </div>
      ) : null}
    </div>
  )
}
