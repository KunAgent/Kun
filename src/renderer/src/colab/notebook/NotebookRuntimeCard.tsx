import { useCallback, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal } from 'lucide-react'
import { formatColabDuration, useColabStore } from '../colab-store'
import { useColabDismiss } from '../use-colab-dismiss'
import { isLocalJupyterUrl } from './JupyterRuntimeSection'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

function formatCompactHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function MiniMeter({
  label,
  pct,
  barClass
}: {
  label: string
  pct: number | null
  barClass: string
}): ReactElement {
  const clamped = Math.min(100, Math.max(0, pct ?? 0))
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[10px] text-ds-muted" title={label}>
        {label}
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-ds-hover">
        <span className={`block h-full rounded-full ${barClass}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

function RuntimeActionsMenu({
  onManage,
  onDisconnect
}: {
  onManage: () => void
  onDisconnect: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useColabDismiss(open, close, menuRef)

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('colabNb.manageRuntime')}
        title={t('colabNb.manageRuntime')}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-40 mb-1.5 w-36 rounded-[10px] border border-ds-border bg-ds-card py-1 text-[12px] shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onManage()
            }}
            className="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-[7px] px-2.5 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
          >
            {t('colabNb.manageRuntime')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onDisconnect()
            }}
            className="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-[7px] px-2.5 py-1.5 text-left text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            {t('colabNb.disconnect')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Compact bottom runtime status strip in the Notebook left sidebar. */
export function NotebookRuntimeCard({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const connections = useColabStore((s) => s.snapshot.connections)
  const kernelBusy = useColabNotebookStore((s) => Boolean(s.runningCellId || s.queue.length))
  const setKernelPickerOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)

  const usingJupyter = Boolean(
    runtime.activeSessionId &&
      runtime.jupyterSession &&
      runtime.activeSessionId === runtime.jupyterSession.id
  )
  const colabLive = !usingJupyter ? (runtime.session ?? runtime.pending) : null

  if (usingJupyter && runtime.jupyterSession) {
    const jpy = runtime.jupyterSession
    const local = isLocalJupyterUrl(jpy.baseUrl)
    const primaryTitle = t(local ? 'colabNb.jupyterLocalBadge' : 'colabNb.jupyterRemoteBadge')
    const subtitle = `${formatCompactHost(jpy.baseUrl)} · ${jpy.kernelName}`
    return (
      <div
        data-colab-runtime-card="jupyter"
        className="mx-2 mb-2 mt-2 flex shrink-0 items-center gap-2 rounded-[10px] border border-ds-border bg-ds-card px-2.5 py-2 shadow-sm"
      >
        <button
          type="button"
          onClick={() => setKernelPickerOpen(true, { backend: 'jupyter' })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={`${primaryTitle} · ${jpy.serverName} (${jpy.baseUrl})`}
        >
          <span
            className={`h-[7px] w-[7px] shrink-0 rounded-full ${
              kernelBusy ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ds-ink">{primaryTitle}</span>
            <span className="block truncate text-[11px] text-ds-faint">{subtitle}</span>
          </span>
        </button>
        <RuntimeActionsMenu
          onManage={() => setKernelPickerOpen(true, { backend: 'jupyter' })}
          onDisconnect={() => void runtime.disconnectJupyter()}
        />
      </div>
    )
  }

  if (colabLive) {
    const session = runtime.session
    const isPending = !session
    const account = connections.find((c) => c.id === colabLive.connectionId)
    const gpuTitle =
      colabLive.accelerator === 'CPU' ? 'Colab · CPU' : `Colab · ${colabLive.accelerator} GPU`
    const metaParts = [
      account?.name ?? colabLive.connectionName,
      isPending ? t('colabNb.connecting') : formatColabDuration(session.elapsedSeconds),
      colabLive.burnRateCuPerHour != null ? t('colabNb.perHour', { cu: colabLive.burnRateCuPerHour }) : null
    ].filter(Boolean)

    const ramPct =
      session && session.ramGb > 0 && session.ramUsedGb != null
        ? (session.ramUsedGb / session.ramGb) * 100
        : null
    const vramPct =
      session && session.vramGb && session.vramUsedGb != null
        ? (session.vramUsedGb / session.vramGb) * 100
        : null

    return (
      <div
        data-colab-runtime-card={isPending ? 'connecting' : 'colab'}
        className="mx-2 mb-2 mt-2 shrink-0 rounded-[10px] border border-ds-border bg-ds-card px-2.5 py-2 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setKernelPickerOpen(true, { backend: 'colab' })}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                isPending
                  ? 'animate-pulse bg-amber-500'
                  : kernelBusy
                    ? 'animate-pulse bg-amber-500'
                    : 'bg-emerald-500'
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-ds-ink">{gpuTitle}</span>
              <span className="block truncate text-[11px] text-ds-faint" title={metaParts.join(' · ')}>
                {metaParts.join(' · ')}
              </span>
            </span>
          </button>
          <RuntimeActionsMenu
            onManage={() => setKernelPickerOpen(true, { backend: 'colab' })}
            onDisconnect={() => void runtime.disconnect()}
          />
        </div>
        {session ? (
          <div className="mt-2 flex gap-2 border-t border-ds-border-muted pt-1.5">
            <MiniMeter
              label={`RAM ${(session.ramUsedGb ?? 0).toFixed(1)}/${session.ramGb}G`}
              pct={ramPct}
              barClass="bg-accent"
            />
            {session.vramGb != null ? (
              <MiniMeter
                label={`GPU ${(session.vramUsedGb ?? 0).toFixed(1)}/${session.vramGb}G`}
                pct={vramPct}
                barClass="bg-amber-500"
              />
            ) : null}
            <MiniMeter
              label={`${t('colabNb.diskLabel')} ${session.diskUsedPct ?? 0}%`}
              pct={session.diskUsedPct ?? 0}
              barClass="bg-emerald-500"
            />
          </div>
        ) : null}
      </div>
    )
  }

  if (runtime.connecting || runtime.jupyterConnecting) {
    return (
      <div
        data-colab-runtime-card="connecting"
        className="mx-2 mb-2 mt-2 flex shrink-0 items-center gap-2 rounded-[10px] border border-ds-border bg-ds-card px-2.5 py-2 shadow-sm"
      >
        <span className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-amber-500" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ds-ink">
          {t('colabNb.kernelConnecting')}
        </span>
        <button
          type="button"
          onClick={() => setKernelPickerOpen(true)}
          className="shrink-0 rounded-[6px] px-2 py-0.5 text-[11.5px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          {t('colabNb.manageRuntime')}
        </button>
      </div>
    )
  }

  return (
    <div
      data-colab-runtime-card="offline"
      className="mx-2 mb-2 mt-2 flex shrink-0 items-center gap-2 rounded-[10px] border border-ds-border-muted bg-ds-card-muted/70 px-2.5 py-2"
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-ds-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-ds-ink">
          {t('colabNb.runtimeOfflineTitle')}
        </div>
        <div className="truncate text-[11px] text-ds-faint">{t('colabNb.runtimeSubtypesShort')}</div>
      </div>
      <button
        type="button"
        data-colab-runtime-connect
        aria-label={t('colabNb.connectRuntimeBtn')}
        title={t('colabNb.connectRuntimeBtn')}
        onClick={() => setKernelPickerOpen(true)}
        className="shrink-0 rounded-[6px] bg-accent-tint/10 px-2 py-1 text-[12px] font-medium text-accent transition hover:bg-accent-tint/15"
      >
        {t('colabNb.connectJupyterShort')}
      </button>
    </div>
  )
}
