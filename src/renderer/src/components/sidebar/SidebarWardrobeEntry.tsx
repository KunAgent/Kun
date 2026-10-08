import { useState, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { KUN_WARDROBE_RULES } from '@shared/rooms-api'
import { RoomUserAvatarEditor } from '../rooms/RoomUserAvatarEditor'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { useWardrobeOpener } from '../rooms/RoomWardrobeOpening'
import { useWardrobe } from '../rooms/room-wardrobe'
import { wearDropOnMe } from '../rooms/room-wardrobe-wear'
import '../rooms/room-wardrobe.css'

const TEN = KUN_WARDROBE_RULES.tenPull

/** The bottle shelf next to Kun: a ring fills toward the next ten-pull; a click opens the stage. */
export function SidebarWardrobeEntry(): ReactElement | null {
  const { t } = useTranslation('common')
  const state = useWardrobe()
  const [dressing, setDressing] = useState(false)
  const opener = useWardrobeOpener({ onWear: wearDropOnMe, onDress: () => setDressing(true) })
  const count = state.wardrobe?.pending.length ?? 0
  if (!count && !opener.overlay && !dressing) return null
  const progress = Math.min(1, count / TEN)
  return <>
    {count ? <button type="button" className="ds-sidebar-wardrobe" data-sidebar-wardrobe={count} data-ready={count >= TEN || undefined}
      title={t('roomsWardrobeSidebarHint')} onClick={opener.showShelf}>
      <span className="ds-sidebar-wardrobe-ring" style={{ '--progress': `${Math.round(progress * 360)}deg` } as CSSProperties} aria-hidden="true">
        <span><WardrobeBottleIcon size={18} state="sealed" /></span>
      </span>
      <span className="ds-sidebar-wardrobe-label">{t('roomsShelfSidebar', { count })}</span>
      <span className="ds-sidebar-wardrobe-open">{count >= TEN ? t('roomsShelfSidebarReady') : t('roomsShelfSidebarNeed', { count: TEN - count })}</span>
    </button> : null}
    {opener.overlay}
    {dressing ? <RoomUserAvatarEditor onClose={() => setDressing(false)} /> : null}
  </>
}
