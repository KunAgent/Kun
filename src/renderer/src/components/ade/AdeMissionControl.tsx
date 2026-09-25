import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Network } from 'lucide-react'

/**
 * ADE home placeholder. The full Mission Control board (needs-you / running /
 * review / done across workers) lands in P1-20 on top of the ActivityStore;
 * this shell view only anchors the route so an ADE mode without an active
 * thread shows a stable home instead of an empty stage.
 */
export function AdeMissionControl(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 bg-ds-main px-6 text-center">
      <Network className="h-8 w-8 text-ds-faint" strokeWidth={1.5} aria-hidden />
      <h1 className="text-[15px] font-medium text-ds-ink">{t('workspaceModeAdeLabel')}</h1>
      <p className="max-w-sm text-[12.5px] leading-5 text-ds-faint">
        {t('adeEmpty')}
      </p>
    </div>
  )
}
