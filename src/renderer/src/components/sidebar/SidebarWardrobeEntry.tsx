import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RoomUserAvatarEditor } from '../rooms/RoomUserAvatarEditor'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { useWardrobe } from '../rooms/room-wardrobe'
import '../rooms/room-wardrobe.css'

/** Unopened bottles wait here, next to Kun, whichever conversation is open. */
export function SidebarWardrobeEntry(): ReactElement | null {
  const { t } = useTranslation('common')
  const state = useWardrobe()
  const [open, setOpen] = useState(false)
  const count = state.wardrobe?.pending.length ?? 0
  if (!count && !open) return null
  return <>
    {count ? <button type="button" className="ds-sidebar-wardrobe rooms-wardrobe-rarity" data-rarity={state.wardrobe!.pending[0]!.rarity}
      data-sidebar-wardrobe={count} title={t('roomsWardrobeSidebarHint')} onClick={() => setOpen(true)}>
      <WardrobeBottleIcon size={22} />
      <span>{t('roomsWardrobeSidebar', { count })}</span>
      <span>{t('roomsWardrobeOpen')}</span>
    </button> : null}
    {open ? <RoomUserAvatarEditor onClose={() => setOpen(false)} /> : null}
  </>
}
