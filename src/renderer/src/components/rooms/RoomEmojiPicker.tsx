import { Smile } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RoomPopover } from './RoomPopover'
export const ROOM_EMOJI = ['👍', '❤️', '😂', '🎉', '🤔', '👀', '✅', '🚀', '👏', '🙏', '🔥', '💯', '😊', '😮', '😢', '👎', '💡', '🙌', '⭐', '🐱', '🐶', '🌟', '💪', '🫡']
export function RoomEmojiPicker({ onChoose, disabled, reactions = false }: { onChoose: (emoji: string) => void; disabled?: boolean; reactions?: boolean }) {
  const { t } = useTranslation('common')
  return <RoomPopover label={t(reactions ? 'roomsAddReaction' : 'roomsEmoji')} trigger={<Smile size={16} />} side="top" disabled={disabled} width={244}>
    {(close) => <div className="rooms-emoji-grid">{ROOM_EMOJI.map((emoji) => <button key={emoji} type="button" aria-label={emoji}
      onClick={() => { onChoose(emoji); close() }}>{emoji}</button>)}</div>}
  </RoomPopover>
}
