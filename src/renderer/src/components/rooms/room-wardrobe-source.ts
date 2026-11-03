import type { TFunction } from 'i18next'
import type { KunWardrobeDrop } from '@shared/rooms-api'

/** Where a bottle came from, for the drop log and the item detail. */
export function wardrobeDropSource(t: TFunction, drop: KunWardrobeDrop): string {
  switch (drop.source) {
    case 'code': return `Code · ${drop.sourceLabel ?? t('roomsWardrobeSourceCodeTask')}`
    case 'welcome': return t('roomsWardrobeSourceWelcome')
    case 'invite': return t('roomsWardrobeSourceInvite')
    case 'shop': return t('roomsWardrobeSourceShop')
    case 'campaign': return drop.sourceLabel ? `${t('roomsWardrobeSourceCampaign')} · ${drop.sourceLabel}` : t('roomsWardrobeSourceCampaign')
    default: return drop.sourceLabel ?? t('roomsWardrobeSourceChat')
  }
}
