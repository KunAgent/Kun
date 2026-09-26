import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, Clock3, HelpCircle, Loader2 } from 'lucide-react'
import type { ActivityRow } from '@shared/activity-row'
import { activityGlyph } from './activity-glyph'

/**
 * Compact status mark driven by `activityGlyph` (docs/ade/12 §3): working
 * spins, waiting is an amber ?, failed a red dot, reviewable-done a green
 * check, done a green dot, idle grey. `stalled` adds a clock hint.
 */
export function StatusDot({ row, now }: { row: ActivityRow; now?: number }): ReactElement {
  const { t } = useTranslation('common')
  const glyph = activityGlyph(row, now)
  const label = glyph.stalled
    ? `${t(glyph.labelKey)} · ${t('adeStatusStalled')}`
    : t(glyph.labelKey)
  const iconClass = 'h-3.5 w-3.5'
  const toneClass = `text-ds-status-${glyph.tone}`
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 ${toneClass}`}
      role="img"
      aria-label={label}
      data-status-dot={glyph.tone}
      data-stalled={glyph.stalled || undefined}
    >
      {glyph.mark === 'spinner' ? (
        <Loader2 className={`${iconClass} animate-spin`} strokeWidth={2} aria-hidden />
      ) : glyph.mark === 'question' ? (
        <HelpCircle className={iconClass} strokeWidth={2} aria-hidden />
      ) : glyph.mark === 'check' ? (
        <CheckCircle2 className={iconClass} strokeWidth={2} aria-hidden />
      ) : (
        <Circle
          className={iconClass}
          strokeWidth={0}
          fill={`var(--ds-status-dot-${glyph.tone})`}
          aria-hidden
        />
      )}
      {glyph.stalled ? <Clock3 className="h-3 w-3" strokeWidth={2} aria-hidden /> : null}
    </span>
  )
}
