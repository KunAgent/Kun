import { useState, type ReactElement } from 'react'
import { Feather } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { kunWardrobeRules, type KunAvatarRarity, type KunWardrobe } from '@shared/rooms-api'
import type { KunShopOffer } from '@shared/kun-account-economy'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { accountResult } from '../rooms/room-wardrobe'
import { useAccountRead, wardrobeErrorText } from './wardrobe-account'

const RARITIES: KunAvatarRarity[] = ['common', 'rare', 'epic', 'legendary']

/** Feathers buy sealed bottles from the account shop; opening reveals the server-selected reward. */
export function WardrobeShopPanel({ wardrobe, language, onBought }: {
  wardrobe: KunWardrobe; language: 'zh' | 'en'; onBought: (text: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const shop = useAccountRead((api) => api.shop(), true)
  const [buying, setBuying] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const feathers = shop.value?.feathers ?? wardrobe.feathers
  const shelf = shop.value?.shelf ?? { pending: wardrobe.pending.length, limit: kunWardrobeRules(wardrobe).shelfLimit }

  const buy = async (offer: KunShopOffer) => {
    setBuying(offer.id)
    setFailure('')
    try {
      const result = await accountResult((api) => api.purchase(offer.id))
      shop.setValue(result.shop)
      onBought(t('wardrobeShopBought', { n: result.purchase.bottles }))
    } catch (cause) { setFailure(wardrobeErrorText(t, cause)) }
    finally { setBuying(null) }
  }
  const label = (offer: KunShopOffer): { text: string; enabled: boolean } => {
    if (offer.dailyLimit !== null && offer.purchasedToday >= offer.dailyLimit) return { text: t('wardrobeShopLimit'), enabled: false }
    if (shelf.pending + offer.bottles > shelf.limit) return { text: t('wardrobeShopShelfFull'), enabled: false }
    if (feathers < offer.price) return { text: t('wardrobeShopShort', { n: offer.price - feathers }), enabled: false }
    return { text: t('wardrobeShopBuy', { price: offer.price }), enabled: true }
  }

  return <div className="kun-wardrobe-scroll kun-wardrobe-shop" data-wardrobe-shop>
    <div className="kun-wardrobe-shop-head">
      <p>{t('wardrobeShopIntro')}</p>
      <span className="kun-wardrobe-shop-balance" data-wardrobe-shop-feathers={feathers}>
        <Feather size={16} strokeWidth={2} aria-hidden="true" /><b>{feathers}</b><small>{t('wardrobeShopFeathers')}</small>
      </span>
      <span className="kun-wardrobe-shop-shelf">
        <small>{t('wardrobeShopShelf', { pending: shelf.pending, limit: shelf.limit })}</small>
        <i aria-hidden="true"><b style={{ width: `${Math.min(100, Math.round(shelf.pending / Math.max(1, shelf.limit) * 100))}%` }} /></i>
      </span>
    </div>
    {shop.error && !shop.value ? <p className="kun-wardrobe-shop-error" role="alert">{wardrobeErrorText(t, shop.error)}
      <button type="button" onClick={() => void shop.reload()}>{t('wardrobeAccountRetry')}</button></p> : null}
    <div className="kun-wardrobe-offers">
      {(shop.value?.offers ?? []).map((offer) => {
        const state = label(offer)
        const many = offer.bottles > 1
        return <article key={offer.id} className="kun-wardrobe-offer" data-many={many || undefined} data-wardrobe-offer={offer.id}>
          <span className="kun-wardrobe-offer-art" aria-hidden="true">
            <WardrobeBottleIcon size={many ? 46 : 58} state="sealed" />{many ? <WardrobeBottleIcon size={54} state="glowing" /> : null}
          </span>
          <span className="kun-wardrobe-offer-text">
            <strong>{offer.title[language] ?? offer.title.zh ?? offer.id}</strong>
            <b><Feather size={15} strokeWidth={2} aria-hidden="true" />{offer.price}</b>
            <small>{offer.dailyLimit === null ? t('wardrobeShopNoLimit')
              : t('wardrobeShopToday', { n: offer.purchasedToday, limit: offer.dailyLimit })}{many ? ` · ${t('wardrobeShopTenNote')}` : ''}</small>
          </span>
          <button type="button" disabled={!state.enabled || buying !== null} onClick={() => void buy(offer)} data-wardrobe-buy={offer.id}>
            {buying === offer.id ? t('wardrobeShopBuying') : state.text}</button>
        </article>
      })}
      {shop.loading && !shop.value ? <p className="kun-wardrobe-shop-note">{t('roomsLoading')}</p> : null}
    </div>
    {failure ? <p className="kun-wardrobe-shop-error" role="alert">{failure}</p> : null}
    <p className="kun-wardrobe-shop-note">{t('wardrobeShopWhere', { values: RARITIES.map((rarity) => kunWardrobeRules(wardrobe).duplicateFeathers[rarity]).join(' / ') })}</p>
  </div>
}
