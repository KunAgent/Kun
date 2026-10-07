import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleStop, Loader2, Pencil, Play } from 'lucide-react'
import type { AgentDispatchIntentView } from '@shared/agent-dispatch'
import { useAgentDispatchIntent } from './use-agent-dispatch-intent'

export function AgentDispatchIntentControls({ intentId, initial, onEdit, onChanged, onTakeover, readOnly = false }: {
  intentId: string
  initial?: AgentDispatchIntentView
  onEdit?: (intent: AgentDispatchIntentView) => Promise<void> | void
  onChanged?: (intent: AgentDispatchIntentView) => Promise<void> | void
  onTakeover?: (intent: AgentDispatchIntentView) => Promise<void> | void
  readOnly?: boolean
}) {
  const { t } = useTranslation('common')
  const { intent, busy, error, act } = useAgentDispatchIntent(intentId, initial)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (intent?.state !== 'countdown') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [intent?.state, intent?.deadline])
  if (!intent) return <p role="status" className="text-xs text-ds-muted">{error || t('dispatchIntent.loading')}</p>
  const pending = ['pending_confirmation', 'countdown', 'paused'].includes(intent.state)
  const active = ['reviewing', 'queued', 'starting', 'uncertain', 'running', 'awaiting_parent', 'stopping'].includes(intent.state)
  const seconds = intent.deadline ? Math.max(0, Math.ceil((Date.parse(intent.deadline) - now) / 1000)) : 0
  const run = async (action: 'start_now' | 'resume' | 'cancel' | 'takeover') => {
    const next = await act(action)
    if (next) {
      await onChanged?.(next)
      if (action === 'takeover') await onTakeover?.(next)
    }
  }
  const edit = async () => {
    const paused = intent.state === 'paused' ? intent : await act('pause')
    if (paused) await onEdit?.(paused)
  }
  return <div className="mt-3 space-y-2" data-agent-dispatch-controls data-state={intent.state}>
    <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-ds-muted">
      {active ? <Loader2 size={13} className="animate-spin shrink-0" aria-hidden /> : null}
      {intent.state === 'countdown'
        ? t('dispatchIntent.countdown', { seconds })
        : t(`dispatchIntent.status.${intent.state}`)}
    </p>
    {intent.decision?.decision === 'deny' || intent.error ? <p role="alert" className="text-xs text-red-600 dark:text-red-300">
      {intent.error || intent.decision?.reason}
    </p> : null}
    {!readOnly ? <div className="flex flex-wrap items-center gap-2 text-xs">
      {pending ? <button type="button" disabled={busy} onClick={() => void run(intent.state === 'paused' ? 'resume' : 'start_now')}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50">
        <Play size={12} aria-hidden />{t(intent.state === 'paused' ? 'dispatchIntent.resume' :
          intent.state === 'pending_confirmation' ? 'dispatchIntent.confirm' : 'dispatchIntent.startNow')}
      </button> : null}
      {pending && onEdit ? <button type="button" disabled={busy} onClick={() => void edit()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 hover:bg-ds-hover disabled:opacity-50">
        <Pencil size={12} aria-hidden />{t('dispatchIntent.adjust')}
      </button> : null}
      {intent.target && !intent.takenOver && ['queued', 'running', 'awaiting_parent'].includes(intent.state) ? <button type="button" disabled={busy} onClick={() => void run('takeover')}
        className="rounded-lg border border-ds-border px-2.5 py-1.5 hover:bg-ds-hover disabled:opacity-50">{t('dispatchIntent.takeover')}</button> : null}
      {(pending || active) && intent.state !== 'stopping' ? <button type="button" disabled={busy} onClick={() => void run('cancel')}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-ds-hover disabled:opacity-50">
        <CircleStop size={12} aria-hidden />{t(intent.target ? 'dispatchIntent.stop' : 'dispatchIntent.cancel')}
      </button> : null}
    </div> : null}
    {intent.takenOver ? <p className="text-xs text-ds-muted">{t('dispatchIntent.takenOver')}</p> : null}
    {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
  </div>
}
