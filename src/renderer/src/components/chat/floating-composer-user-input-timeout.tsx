import { useEffect, useState, type ReactElement } from 'react'
import { Clock } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'

type Translate = (key: string, options?: Record<string, unknown>) => string

type UserInputBlock = Extract<ChatBlock, { kind: 'user_input' }>

/**
 * Countdown chip for a live `user_input` request carrying `timeoutSeconds`.
 * Rendered while the runtime is still awaiting the answer; once the deadline
 * passes it switches to an "elapsed" label until the resolution event lands.
 */
export function UserInputTimeoutCountdownChip({
  block,
  t
}: {
  block: UserInputBlock | null
  t: Translate
}): ReactElement | null {
  const timeoutSeconds = block?.timeoutSeconds
  const createdAt = block?.createdAt
  const deadline = timeoutSeconds !== undefined && createdAt
    ? Date.parse(createdAt) + timeoutSeconds * 1000
    : NaN

  const [remaining, setRemaining] = useState(() =>
    Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0
  )

  useEffect(() => {
    if (!Number.isFinite(deadline)) return
    const tick = (): void => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [deadline])

  if (!Number.isFinite(deadline)) return null

  const elapsed = remaining <= 0
  return (
    <span
      title={elapsed ? t('userInputTimeoutElapsed') : t('userInputTimeoutCountdown', { seconds: remaining })}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 tabular-nums ${
        elapsed
          ? 'border-amber-300/70 bg-amber-500/15 text-amber-600 dark:border-amber-500/40 dark:text-amber-300'
          : 'border-amber-300/70 bg-amber-500/10 text-amber-600 dark:border-amber-500/40 dark:text-amber-300'
      }`}
    >
      <Clock className="h-3 w-3 shrink-0 motion-safe:animate-pulse" strokeWidth={2.1} aria-hidden="true" />
      <span>
        {elapsed
          ? t('userInputTimeoutElapsed')
          : t('userInputTimeoutCountdown', { seconds: remaining })}
      </span>
    </span>
  )
}
