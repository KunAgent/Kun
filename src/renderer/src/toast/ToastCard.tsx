import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { AgentElapsed } from '../components/ade/AgentCenterParts'
import { useToastStore } from './toast-store'
import type { ToastItem, ToastTone } from './toast-types'
import './toast.css'

const TONE_ICON = {
  running: LoaderCircle,
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleX
} as const

/** Same palette as the rest of the shell, so both themes follow the tokens. */
const TONE_COLOR: Record<ToastTone, string> = {
  running: 'text-accent',
  success: 'text-ds-status-success',
  info: 'text-accent',
  warning: 'text-ds-status-warning',
  error: 'text-ds-status-danger'
}

const ACTION_CLASS = 'inline-flex min-h-[28px] items-center gap-1 rounded-md border px-2.5 text-[12px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const PRIMARY_ACTION_CLASS = `${ACTION_CLASS} border-ds-border-muted bg-ds-subtle text-ds-ink hover:bg-ds-hover`
const QUIET_ACTION_CLASS = `${ACTION_CLASS} border-transparent text-ds-muted hover:border-ds-border hover:bg-ds-subtle hover:text-ds-ink`

/**
 * One unified notification card: a tone icon, the message, optional progress
 * and follow-up actions. Failures announce as alerts; everything else is a
 * polite status. Hovering or focusing the card pauses its countdown.
 */
export function ToastCard({ item }: { item: ToastItem }): ReactElement {
  const { t } = useTranslation('common')
  const pause = useToastStore((state) => state.pause)
  const resume = useToastStore((state) => state.resume)
  const dismiss = useToastStore((state) => state.dismiss)
  const Icon = TONE_ICON[item.tone]
  const alerting = item.tone === 'error' || item.tone === 'warning'
  const percent = item.progress?.percent

  return (
    <article
      role={alerting ? 'alert' : 'status'}
      data-toast-id={item.id}
      data-toast-tone={item.tone}
      aria-busy={item.tone === 'running' ? true : undefined}
      onPointerEnter={() => pause(item.id)}
      onPointerLeave={() => resume(item.id)}
      onFocus={() => pause(item.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume(item.id)
      }}
      className="kun-toast pointer-events-auto relative rounded-xl border border-ds-border bg-ds-card p-4 text-ds-ink shadow-[0_14px_36px_rgba(15,23,42,0.09)] motion-safe:animate-[kun-toast-enter_150ms_ease-out] dark:shadow-[0_22px_56px_rgba(0,0,0,0.3)]"
    >
      <div className="flex items-start gap-3">
        <Icon
          aria-hidden
          strokeWidth={1.9}
          className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${TONE_COLOR[item.tone]} ${item.tone === 'running' ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold leading-5">
            <span className="min-w-0 break-words">{item.title}</span>
            {item.badge ? (
              <span className="shrink-0 rounded bg-ds-subtle px-1.5 text-[10px] font-normal tabular-nums text-ds-muted">
                {item.badge}
              </span>
            ) : null}
          </h3>
          {item.description || item.since ? (
            <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1 text-[12px] leading-[1.65] text-ds-muted [overflow-wrap:anywhere]">
              {item.description ? <span className="min-w-0">{item.description}</span> : null}
              {item.since ? (
                <span className="shrink-0">
                  {item.description ? '· ' : null}
                  <AgentElapsed since={item.since} />
                </span>
              ) : null}
            </p>
          ) : null}
          {item.progress ? (
            <div className="mt-3">
              <div
                role="progressbar"
                aria-label={item.progress.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent === undefined ? undefined : Math.round(percent)}
                aria-busy={percent === undefined ? true : undefined}
                className="h-1 w-full overflow-hidden rounded bg-ds-subtle"
              >
                <i
                  className={`block h-full rounded bg-accent ${percent === undefined ? 'w-1/3 animate-pulse motion-reduce:animate-none' : 'motion-safe:transition-[width] motion-safe:duration-200'}`}
                  style={percent === undefined ? undefined : { width: `${Math.max(2, Math.min(100, percent))}%` }}
                />
              </div>
              {item.progress.detail || item.progress.trailing || percent !== undefined ? (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] tabular-nums text-ds-muted">
                  <span className="min-w-0 truncate">{item.progress.detail}</span>
                  <span className="shrink-0">
                    {item.progress.trailing ?? (percent === undefined ? '' : `${Math.round(percent)}%`)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          {item.actions?.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {item.actions.map((action, index) => (
                <button
                  key={`${action.label}:${index}`}
                  type="button"
                  onClick={() => {
                    action.run()
                    dismiss(item.id)
                  }}
                  className={index === 0 ? PRIMARY_ACTION_CLASS : QUIET_ACTION_CLASS}
                >
                  {action.label}
                  {action.shortcut ? (
                    <kbd className="ml-1 font-[inherit] text-[10px] font-normal text-ds-muted">{action.shortcut}</kbd>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dismiss(item.id)}
          aria-label={t('close')}
          title={t('close')}
          data-toast-close
          className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </article>
  )
}
