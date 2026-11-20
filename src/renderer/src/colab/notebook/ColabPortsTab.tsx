import { useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink, Loader2, Network, X } from 'lucide-react'
import { COLAB_RESERVED_VM_PORT, type ColabPortForwardView } from '@shared/colab/colab-notebook-types'
import { useColabNotebookStore } from './colab-notebook-store'
import { useColabPortForwardStore } from './colab-port-forward-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const PRESETS: ReadonlyArray<{ label: string; port: number }> = [
  { label: 'Gradio', port: 7860 },
  { label: 'TensorBoard', port: 6006 },
  { label: 'Streamlit', port: 8501 },
  { label: 'API / LLM', port: 8000 }
]

function stateBadge(
  fwd: ColabPortForwardView,
  t: (key: string, opts?: Record<string, unknown>) => string
): { dot: string; text: string; tone: string } {
  switch (fwd.state) {
    case 'up':
      return {
        dot: 'bg-emerald-500',
        text: t('colabNb.portsStateUp'),
        tone: 'text-emerald-600 dark:text-emerald-400'
      }
    case 'reconnecting':
      return {
        dot: 'animate-pulse bg-amber-500',
        text: t('colabNb.portsStateReconnecting', { attempt: fwd.reconnectAttempt ?? 1 }),
        tone: 'text-amber-600 dark:text-amber-400'
      }
    case 'failed':
      return {
        dot: 'bg-red-500',
        text: t('colabNb.portsStateFailed'),
        tone: 'text-red-600 dark:text-red-400'
      }
    default:
      return {
        dot: 'animate-pulse bg-amber-500',
        text: t('colabNb.portsStateStarting'),
        tone: 'text-ds-muted'
      }
  }
}

export function ColabPortsTab({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const setKernelPickerOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)
  const allForwards = useColabPortForwardStore((s) => s.forwards)
  const startForward = useColabPortForwardStore((s) => s.startForward)
  const stopForward = useColabPortForwardStore((s) => s.stopForward)

  const [remoteInput, setRemoteInput] = useState('')
  const [localInput, setLocalInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const sessionId = runtime.activeSessionId
  const usingJupyter = Boolean(
    sessionId && runtime.jupyterSession && sessionId === runtime.jupyterSession.id
  )

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="text-[12.5px] text-ds-muted">{t('colabNb.portsEmptyHint')}</p>
        <button
          type="button"
          onClick={() => setKernelPickerOpen(true)}
          className="rounded-[8px] border border-ds-border bg-ds-main px-3 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
        >
          {t('colabNb.connectRuntimeBtn')}
        </button>
      </div>
    )
  }

  if (usingJupyter && runtime.jupyterSession) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="text-[12.5px] text-ds-muted">{t('colabNb.portsJupyterHint')}</p>
        <button
          type="button"
          onClick={runtime.openExternalNotebookUi}
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main px-3 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span>{t('colabNb.jupyterOpenLab')}</span>
        </button>
      </div>
    )
  }

  const colabSessionId = runtime.session?.id ?? sessionId
  const forwards = allForwards.filter((item) => item.sessionId === colabSessionId)
  const activePorts = new Set(
    forwards.filter((item) => item.state !== 'failed').map((item) => item.remotePort)
  )

  const triggerForward = async (
    remotePort: number,
    localPort?: number,
    label?: string
  ): Promise<void> => {
    if (busy) return
    if (remotePort === COLAB_RESERVED_VM_PORT) {
      setError(t('colabNb.portsReserved8080'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await startForward({
        sessionId: colabSessionId,
        remotePort,
        localPort,
        label
      })
      if (!res.ok) setError(res.message)
      else {
        setRemoteInput('')
        setLocalInput('')
      }
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const remotePort = Number(remoteInput.trim())
    const localPort = localInput.trim() ? Number(localInput.trim()) : remotePort
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return
    void triggerForward(remotePort, localPort)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-colab-tab-pane="ports">
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-ds-faint">
            {t('colabNb.portsPresetsTitle')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => {
              const active = activePorts.has(preset.port)
              return (
                <button
                  key={preset.port}
                  type="button"
                  disabled={busy || active}
                  onClick={() => void triggerForward(preset.port, preset.port, preset.label)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300'
                      : 'border-ds-border bg-ds-main/60 text-ds-ink hover:border-accent/40 hover:bg-ds-hover'
                  }`}
                >
                  <span>{preset.label}</span>
                  <span className="font-mono text-[11px] text-ds-muted">:{preset.port}</span>
                </button>
              )
            })}
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex items-end gap-1.5 rounded-[10px] border border-ds-border bg-ds-main/50 p-2.5"
        >
          <label className="min-w-0 flex-1 space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.portsRemoteLabel')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              required
              placeholder="8000"
              value={remoteInput}
              onChange={(e) => setRemoteInput(e.target.value)}
              className="w-full rounded-[7px] border border-ds-border bg-ds-card px-2 py-1 font-mono text-[12px] text-ds-ink focus:border-accent focus:outline-none"
            />
          </label>
          <label className="min-w-0 flex-1 space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.portsLocalLabel')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              placeholder={remoteInput || '8000'}
              value={localInput}
              onChange={(e) => setLocalInput(e.target.value)}
              className="w-full rounded-[7px] border border-ds-border bg-ds-card px-2 py-1 font-mono text-[12px] text-ds-ink focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !remoteInput.trim()}
            className="inline-flex h-[30px] shrink-0 items-center gap-1 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-45"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            <span>{t('colabNb.portsForwardBtn')}</span>
          </button>
        </form>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {forwards.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-[12px] text-ds-faint">
            <Network className="h-5 w-5 opacity-60" aria-hidden="true" />
            <p>{t('colabNb.portsEmptyHint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {forwards.map((fwd) => {
              const badge = stateBadge(fwd, t)
              return (
                <div
                  key={fwd.id}
                  className="rounded-[10px] border border-ds-border bg-ds-main/40 p-2.5 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {fwd.label ? (
                          <span className="font-semibold text-ds-ink">{fwd.label}</span>
                        ) : null}
                        <span className="truncate font-mono text-[11.5px] text-ds-ink">
                          127.0.0.1:{fwd.localPort} → :{fwd.remotePort}
                        </span>
                      </div>
                      <div className={`mt-0.5 inline-flex items-center gap-1.5 text-[11px] ${badge.tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                        <span>{badge.text}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={fwd.state !== 'up'}
                        title={t('colabNb.portsOpenBrowser')}
                        aria-label={t('colabNb.portsOpenBrowser')}
                        onClick={() => window.open(fwd.localUrl, '_blank', 'noopener,noreferrer')}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title={copiedId === fwd.id ? t('colabNb.portsCopied') : t('colabNb.portsCopyUrl')}
                        aria-label={t('colabNb.portsCopyUrl')}
                        onClick={async () => {
                          await navigator.clipboard?.writeText(fwd.localUrl)
                          setCopiedId(fwd.id)
                          setTimeout(() => setCopiedId((cur) => (cur === fwd.id ? null : cur)), 1500)
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                      >
                        {copiedId === fwd.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={t('cancel')}
                        onClick={() => void stopForward(fwd.id)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-ds-muted hover:bg-red-500/10 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {fwd.errorMessage ? (
                    <p className="mt-1 break-words text-[11px] text-red-600 dark:text-red-400">
                      {fwd.errorMessage}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ds-border bg-ds-subtle/50 px-3.5 py-2 text-[11px] leading-snug text-ds-muted">
        {t('colabNb.portsBillingNotice')}
      </div>
    </div>
  )
}
