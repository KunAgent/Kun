import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CircleSlash, Loader2, Pause, TriangleAlert, UserCheck } from 'lucide-react'
import type { AgentDispatchIntentView } from '@shared/agent-dispatch'
import { dispatchCountdown, dispatchPhase, formatDispatchClock } from './agent-dispatch-card-model'

const RING = 2 * Math.PI * 6

/** Draining ring: full when the window opens, empty when the card starts on its own. */
function CountdownRing({ fraction }: { fraction: number }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="-rotate-90 shrink-0">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeDasharray={RING} strokeDashoffset={RING * (1 - fraction)} style={{ transition: 'stroke-dashoffset 0.5s linear' }} />
  </svg>
}

const pill = 'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium'

/** Header status: the no-response countdown while waiting, otherwise the card phase. */
export function AgentDispatchStatusBadge({ intent }: { intent: AgentDispatchIntentView }) {
  const { t } = useTranslation('common')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (intent.state !== 'countdown') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [intent.state, intent.deadline])
  const countdown = dispatchCountdown(intent, now)
  if (countdown) {
    const askFirst = intent.recommendation.permissionMode !== 'full-access'
    return <span role="timer" data-dispatch-countdown className={`${pill} bg-accent-tint/10 text-accent`}>
      <CountdownRing fraction={countdown.fraction} />
      <span className="tabular-nums">{t(askFirst ? 'dispatchIntent.autoIfNoReply' : 'dispatchIntent.autoIn',
        { time: formatDispatchClock(countdown.remainingMs) })}</span>
    </span>
  }
  const phase = dispatchPhase(intent.state)
  if (phase === 'waiting') return <span className={`${pill} bg-ds-subtle text-ds-status-warning`}>
    <UserCheck size={13} aria-hidden />{t('dispatchIntent.status.pending_confirmation')}</span>
  if (phase === 'paused') return <span className={`${pill} bg-ds-subtle text-ds-muted`}>
    <Pause size={13} aria-hidden />{t('dispatchIntent.pausedHold')}</span>
  if (phase === 'completed') return <span className={`${pill} bg-ds-success-soft text-ds-status-success`}>
    <Check size={13} aria-hidden />{t('dispatchIntent.status.completed')}</span>
  if (phase === 'failed') return <span className={`${pill} bg-ds-danger-soft text-ds-status-danger`}>
    <TriangleAlert size={13} aria-hidden />{t('dispatchIntent.status.failed')}</span>
  if (phase === 'cancelled') return <span className={`${pill} bg-ds-subtle text-ds-muted`}>
    <CircleSlash size={13} aria-hidden />{t('dispatchIntent.status.cancelled')}</span>
  return <span role="status" className={`${pill} bg-ds-subtle text-ds-status-running`}>
    <Loader2 size={13} className="animate-spin" aria-hidden />{t(`dispatchIntent.status.${intent.state}`)}</span>
}
