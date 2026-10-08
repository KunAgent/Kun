import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { KUN_AVATAR_RARITY_LABELS, type KunWardrobeDrop } from '@shared/rooms-api'
import { WardrobeBottleIcon } from './RoomWardrobeBottle'
import { RoomWardrobeReveal } from './RoomWardrobeReveal'
import { openWardrobeDrop, pendingWardrobeDrops, useWardrobe, type WardrobeOpenResult } from './room-wardrobe'
import './room-wardrobe.css'

/** A bottle washed up under the Agent's reply; "later" folds it into one line until the next visit. */
export function RoomWardrobeDropCard({ roomId }: { roomId: string }): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const state = useWardrobe()
  const [later, setLater] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [reveal, setReveal] = useState<WardrobeOpenResult | null>(null)
  const pending = pendingWardrobeDrops(state.wardrobe, roomId)
  const shown = pending.find((drop) => !later.has(drop.id))
  const open = async (drop: KunWardrobeDrop) => {
    setBusy(drop.id); setError('')
    try { setReveal(await openWardrobeDrop(drop.id)) } catch (cause) { setError(String(cause)) } finally { setBusy('') }
  }
  if (!pending.length && !reveal) return null
  return <div className="rooms-wardrobe-drop-slot" data-wardrobe-pending={pending.length}>
    {shown ? <div className="rooms-wardrobe-drop rooms-wardrobe-rarity" data-rarity={shown.rarity} role="status" data-wardrobe-drop={shown.id}>
      <WardrobeBottleIcon size={34} />
      <div className="rooms-wardrobe-drop-text">
        <strong>{t('roomsWardrobeFound')}</strong>
        <span>{t('roomsWardrobeFoundHint', { rarity: KUN_AVATAR_RARITY_LABELS[shown.rarity][language] })}</span>
      </div>
      <div className="rooms-wardrobe-drop-actions">
        <button type="button" onClick={() => setLater(new Set([...later, shown.id]))}>{t('roomsWardrobeLater')}</button>
        <button type="button" className="rooms-run-primary" disabled={busy === shown.id} onClick={() => void open(shown)}>
          {t(busy === shown.id ? 'roomsWardrobeOpening' : 'roomsWardrobeOpen')}</button>
      </div>
    </div> : pending.length ? <button type="button" className="rooms-wardrobe-drop-more" onClick={() => setLater(new Set())}>
      <WardrobeBottleIcon size={18} />{t('roomsWardrobeMore', { count: pending.length })}</button> : null}
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    {reveal ? <RoomWardrobeReveal result={reveal} onClose={() => setReveal(null)} /> : null}
  </div>
}
