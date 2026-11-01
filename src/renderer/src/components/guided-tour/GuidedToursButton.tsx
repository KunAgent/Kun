import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleHelp } from 'lucide-react'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import { useGuidedTourStore } from './guided-tour-store'

/** Sidebar footer ?: opens the list of guided tours. Every tour's last step points here. */
export function GuidedToursButton(): ReactElement {
  const { t } = useTranslation('common')
  const hubOpen = useGuidedTourStore((s) => s.hubOpen)
  return (
    <span className="inline-flex" data-guided-tours-button>
      <SidebarIconButton title={t('guidedTourHubTitle')} ariaLabel={t('guidedTourHubTitle')} active={hubOpen}
        onClick={() => useGuidedTourStore.getState().setHubOpen(!useGuidedTourStore.getState().hubOpen)}>
        <CircleHelp className="h-4 w-4" strokeWidth={1.75} />
      </SidebarIconButton>
    </span>
  )
}
