import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, LoaderCircle, Settings } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { useAdeReadiness, type AdeReadinessCheck } from './ade-readiness'

/**
 * ADE readiness checklist (docs/ade/impl/p4 §P4-14): rendered at the top of
 * the Mission Control home and the ADE new-session hero so a first-time ADE
 * surface states exactly what is missing — a usable provider for manager
 * turns, a ready turn-capable agent, and the Kun gateway.
 */
export function AdeReadinessCard(): ReactElement {
  const { t } = useTranslation('common')
  const openSettings = useChatStore((s) => s.openSettings)
  const checks = useAdeReadiness()

  const labelFor = (check: AdeReadinessCheck): string =>
    t(`adeReadiness.${check.id}.label`, { defaultValue: check.id })
  const detailFor = (check: AdeReadinessCheck): string => {
    if (check.ok === null) return t('adeReadiness.checking', { defaultValue: 'Checking…' })
    if (check.id === 'provider') {
      return check.ok
        ? t('adeReadiness.provider.ready', { name: check.detail })
        : t('adeReadiness.provider.missing')
    }
    if (check.id === 'agents') {
      return check.ok
        ? t('adeReadiness.agents.ready', { count: Number(check.detail) })
        : t('adeReadiness.agents.missing')
    }
    return check.ok
      ? t('adeReadiness.gateway.ready')
      : t('adeReadiness.gateway.missing')
  }
  const actionFor = (check: AdeReadinessCheck): string =>
    check.id === 'provider'
      ? t('adeReadiness.provider.action')
      : check.id === 'agents'
        ? t('adeReadiness.agents.action')
        : t('adeReadiness.gateway.action')

  return (
    <div
      data-ade-readiness-card
      className="ds-no-drag mx-4 mb-2 rounded-2xl border border-ds-border-muted bg-ds-card/85 px-4 py-3 shadow-[0_10px_28px_rgba(32,55,90,0.05)]"
    >
      <div className="flex flex-wrap items-stretch gap-x-6 gap-y-2">
        {checks.map((check) => (
          <div key={check.id} className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
            {check.ok === null ? (
              <LoaderCircle
                className="h-4 w-4 shrink-0 animate-spin text-ds-faint motion-reduce:animate-none"
                strokeWidth={1.8}
              />
            ) : check.ok ? (
              <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={1.8} />
            ) : (
              <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.8} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-ds-ink">
                {labelFor(check)}
              </span>
              <span className="block truncate text-[11px] text-ds-muted">
                {detailFor(check)}
              </span>
            </span>
            {check.ok === false ? (
              <button
                type="button"
                onClick={() => openSettings(check.section)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border-muted bg-ds-main px-2.5 py-1 text-[11px] font-medium text-ds-muted transition hover:text-ds-ink"
              >
                <Settings className="h-3 w-3" strokeWidth={1.8} />
                {actionFor(check)}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
