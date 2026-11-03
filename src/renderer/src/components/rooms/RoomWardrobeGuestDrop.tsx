import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GuestWardrobeHint, WardrobeDropScope } from './room-wardrobe'
import { WardrobeBottleIcon } from './RoomWardrobeBottle'
import { signInToKun } from '../wardrobe/wardrobe-account'
export function RoomWardrobeGuestDrop({ hints, scope }: { hints: GuestWardrobeHint[]; scope: WardrobeDropScope }) {
  const { t } = useTranslation('common')
  const [dismissed, setDismissed] = useState<string[]>([])
  const hint = [...hints].reverse().find(item => !dismissed.includes(item.id) && Date.now() - Date.parse(item.createdAt) < 24 * 60 * 60_000 &&
    (scope.roomId ? item.roomId === scope.roomId : Boolean(scope.threadId) && item.threadId === scope.threadId))
  if (!hint) return null
  return <div className="rooms-wardrobe-drop-slot" data-wardrobe-guest-drop={hint.id}>
    <div className="rooms-wardrobe-drop" role="status">
      <WardrobeBottleIcon size={40} state="glowing" />
      <div className="rooms-wardrobe-drop-text"><strong>{t('wardrobeGuestDropTitle')}</strong><span>{t('wardrobeGuestDropBody')}</span></div>
      <div className="rooms-wardrobe-drop-actions">
        <button type="button" onClick={() => setDismissed([...dismissed, hint.id])}>{t('wardrobeGuestDropDismiss')}</button>
        <button type="button" className="rooms-run-primary" onClick={signInToKun}>{t('wardrobeAccountSignIn')}</button>
      </div>
    </div>
  </div>
}
