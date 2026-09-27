import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ActivityRow } from '@shared/activity-row'
import { activityGlyph } from './activity-glyph'
import { StatusDot } from './StatusDot'

/**
 * Status pill = StatusDot + translated label (docs/ade/12 §3). Used where a
 * bare dot would be ambiguous (column headers, worker rows, banners).
 */
export function StatusBadge({
  row,
  now,
  className
}: {
  row: ActivityRow
  now?: number
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const glyph = activityGlyph(row, now)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-ds-status-${glyph.tone} ${className ?? ''}`}
      data-status-badge={glyph.tone}
    >
      <StatusDot row={row} now={now} />
      {t(glyph.labelKey)}
      {glyph.stalled ? ` · ${t('adeStatusStalled')}` : ''}
    </span>
  )
}
