import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'
import { replayCodeTour } from './code-tour-store'

/** Code home: reopens the first-open tour from its welcome card. */
export function CodeTourReplayButton(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button type="button" data-code-tour-replay onClick={replayCodeTour} title={t('codeTourReplay')}
      className="ds-no-drag inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-0.5 text-[12.5px] font-medium leading-5 text-ds-muted shadow-sm transition hover:border-accent/30 hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
      <Compass size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>{t('codeTourReplay')}</span>
    </button>
  )
}
