import type { ReactElement, ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_RARITY_LABELS, KUN_WARDROBE_STARTER_PACK, KUN_WARDROBE_RULES, kunAvatarRarity,
  kunWardrobeItemKey, kunWardrobeMissingParts, kunWardrobePartKeys,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunAvatarRarity, type KunWardrobe
} from '@shared/rooms-api'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { RoomAvatarItemArt } from '../rooms/RoomAvatarItemArt'
import { WardrobeCardBack, WardrobeUnknownItem } from '../rooms/RoomWardrobeBottle'
import { wardrobeOwns, type WardrobeSelection } from './wardrobe-page-model'
import { WARDROBE_SLOT_LABELS } from './WardrobeStage'

type Language = 'zh' | 'en'
type Sheet = { rarity: KunAvatarRarity; art: ReactNode; title: string; chip: string; fresh?: boolean; text: string; meta: string
  action: string; primary: boolean; enabled: boolean; run: () => void; locked: boolean }

function when(value: string, language: Language): string {
  const date = new Date(value), locale = language === 'zh' ? 'zh-CN' : 'en-US'
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

/** The selected item or role card: what it is, where it came from, and the one thing to do with it. */
export function WardrobeInspector({ selection, wardrobe, unlockAll, parts, dressed, language, busy, onWearItem, onExchange, onWearSet, onClose }: {
  selection: WardrobeSelection; wardrobe: KunWardrobe; unlockAll: boolean; parts: KunAvatarParts; dressed: boolean; language: Language; busy: boolean
  onWearItem: (category: KunAvatarAccessoryCategory, id: string, worn: boolean) => void; onExchange: (key: string) => void
  onWearSet: (presetId: string) => void; onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  let sheet: Sheet | null = null
  if (selection?.kind === 'item') {
    const [category, id] = selection.key.split('/') as [KunAvatarAccessoryCategory, string]
    const part = KUN_AVATAR_CATALOG[category]?.find((entry) => entry.id === id)
    if (part) {
      const copies = wardrobeOwns(wardrobe, unlockAll, selection.key)
      const rarity = `${KUN_AVATAR_RARITY_LABELS[part.rarity][language]} · ${t(WARDROBE_SLOT_LABELS[category])}`
      if (copies > 0) {
        const worn = dressed && parts[category] === id
        const drop = (wardrobe.history ?? []).find((entry) => entry.item && kunWardrobeItemKey(entry.item.category, entry.item.id) === selection.key)
        const from = drop ? t('wardrobePageFrom', { source: `${drop.source === 'code' ? 'Code · ' : ''}${drop.sourceLabel
          ?? t(drop.source === 'code' ? 'roomsWardrobeSourceCodeTask' : 'roomsWardrobeSourceChat')} · ${when(drop.openedAt ?? drop.createdAt, language)}` })
          : KUN_WARDROBE_STARTER_PACK.includes(selection.key as never) ? t('wardrobePageStarter') : ''
        sheet = { rarity: part.rarity, art: <RoomAvatarItemArt category={category} id={id} size={48} />, title: part.label[language], chip: rarity,
          fresh: !unlockAll && !wardrobe.seen.includes(selection.key), text: part.flavor[language],
          meta: [from, copies > 1 ? t('wardrobePageCopies', { n: copies }) : ''].filter(Boolean).join(' · '),
          action: t(worn ? 'wardrobePageTakeOff' : 'wardrobePageWear'), primary: !worn, enabled: true, locked: false,
          run: () => onWearItem(category, id, worn) }
      } else {
        const price = KUN_WARDROBE_RULES.exchangeFeathers[part.rarity]
        // Until it is found the item keeps its secret here too; trading feathers reveals it.
        sheet = { rarity: part.rarity, art: <WardrobeUnknownItem size={42} />, title: t('roomsWardrobeUnknownItem'), chip: rarity,
          text: t('roomsWardrobeExchangeHint', { price, missing: Math.max(0, price - wardrobe.feathers) }), meta: t('wardrobePageSecret'),
          action: `${t('roomsWardrobeExchange')} · ${price}`, primary: true, enabled: wardrobe.feathers >= price, locked: true,
          run: () => onExchange(selection.key) }
      }
    }
  } else if (selection?.kind === 'card') {
    const preset = KUN_AVATAR_PRESETS.find((entry) => entry.id === selection.id)
    if (preset) {
      const rarity = kunAvatarRarity(preset.parts)
      const chip = `${KUN_AVATAR_RARITY_LABELS[rarity][language]} · ${t('roomsWardrobeCardKind')}`
      const keys = kunWardrobePartKeys(preset.parts)
      const missing = unlockAll ? 0 : kunWardrobeMissingParts(wardrobe, preset.parts).length
      sheet = unlockAll || wardrobe.roles.includes(preset.id)
        ? { rarity, chip, locked: false, primary: true, enabled: true, title: preset.label[language],
          art: <RoomAvatar avatar={{ kind: 'composed', version: 1, parts: { ...preset.parts, bg: `scene:${preset.cardScene}` } }}
            id={`wardrobe-sheet-${preset.id}`} label="" size={56} user />,
          text: t('wardrobePageSetPieces', { items: keys.map((key) => {
            const [category, id] = key.split('/') as [KunAvatarAccessoryCategory, string]
            return KUN_AVATAR_CATALOG[category].find((entry) => entry.id === id)?.label[language] ?? id
          }).join(' + ') }),
          meta: t('wardrobePageSetKeepsBackdrop'), action: t('roomsWardrobeWearSet'), run: () => onWearSet(preset.id) }
        : { rarity, chip, locked: true, primary: false, enabled: false, title: t('roomsWardrobeUnknownCard'),
          art: <WardrobeCardBack width={40} height={54} />, text: t('roomsWardrobeUnknownCardHint'),
          meta: t('roomsWardrobeCollected', { have: keys.length - missing, total: keys.length }),
          action: t('wardrobePageMissing', { n: missing }), run: () => undefined }
    }
  }
  if (!sheet) return null
  return <div className="kun-wardrobe-sheet rooms-wardrobe-rarity" data-rarity={sheet.rarity} data-locked={sheet.locked || undefined} data-wardrobe-sheet>
    <span className="kun-wardrobe-sheet-art">{sheet.art}</span>
    <span className="kun-wardrobe-sheet-text">
      <span><strong>{sheet.title}</strong><em>{sheet.chip}</em>{sheet.fresh ? <i>NEW</i> : null}</span>
      <span>{sheet.text}</span>
      {sheet.meta ? <small>{sheet.meta}</small> : null}
    </span>
    <button type="button" className="kun-wardrobe-sheet-action" data-primary={sheet.primary || undefined}
      disabled={!sheet.enabled || busy} onClick={sheet.run}>{sheet.action}</button>
    <button type="button" className="kun-wardrobe-sheet-close" onClick={onClose} aria-label={t('wardrobePageCloseDetail')}>
      <X size={15} strokeWidth={2} aria-hidden="true" /></button>
  </div>
}
