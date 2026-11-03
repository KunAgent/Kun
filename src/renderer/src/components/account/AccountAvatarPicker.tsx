import { useRef, useState, type ReactElement } from 'react'
import { Check, ImagePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunAccountUser } from '@shared/kun-account'
import { RoomAvatar } from '../rooms/RoomAvatar'
import {
  ownAccountPicture, setAccountAvatarCustom, setAccountAvatarSource, squareAccountPicture,
  useAccountAvatarRecord, useAccountFace
} from './account-avatar'
import './account-avatar.css'

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const PICTURE_MAX_BYTES = 5 * 1024 * 1024

/** The account's face at any size: the user's own picture, or Kun's dressed-up look. */
export function AccountFace({ user, size }: { user: KunAccountUser | null; size: number }): ReactElement {
  const face = useAccountFace(user)
  const [broken, setBroken] = useState<string | null>(null)
  if (face.kind === 'image' && face.src !== broken) {
    return (
      <span className="kun-account-photo" data-account-face="image" style={{ width: size, height: size, borderRadius: Math.max(5, size * 0.26) }}>
        <img src={face.src} alt="" draggable={false} onError={() => setBroken(face.src)} />
      </span>
    )
  }
  return <RoomAvatar user id="user" label="" size={size} />
}

/**
 * Picks the face the account wears: "My picture" (the account photo, or one chosen on this
 * machine) or Kun's look from the wardrobe. Without a picture, the first choice asks for one.
 */
export function AccountAvatarPicker({ user }: { user: KunAccountUser }): ReactElement {
  const { t } = useTranslation('common')
  const value = useAccountAvatarRecord()
  const own = ownAccountPicture(value, user)
  const ownActive = value.source === 'own' && Boolean(own)
  const file = useRef<HTMLInputElement>(null)
  const [invalid, setInvalid] = useState(false)
  const choose = async (selected: File) => {
    setInvalid(false)
    try {
      if (!PICTURE_TYPES.includes(selected.type) || selected.size > PICTURE_MAX_BYTES) throw new Error('unsupported')
      setAccountAvatarCustom(await squareAccountPicture(selected))
    } catch { setInvalid(true) }
  }
  const upload = () => file.current?.click()
  const hint = invalid ? t('kunAccountAvatarInvalid')
    : !ownActive ? t('kunAccountAvatarHintKun')
      : value.custom ? t('kunAccountAvatarHintLocal') : t('kunAccountAvatarHintAccount')
  return (
    <section className="kun-account-avatar-picker" data-kun-avatar-picker aria-label={t('kunAccountAvatarTitle')}>
      <div className="kun-account-avatar-options" role="radiogroup" aria-label={t('kunAccountAvatarTitle')}>
        <button type="button" role="radio" aria-checked={ownActive} className="kun-account-avatar-option" data-kun-avatar-option="own"
          onClick={() => own ? setAccountAvatarSource('own') : upload()}>
          <span className="kun-account-avatar-preview" data-empty={!own || undefined}>
            {own ? <img src={own} alt="" draggable={false} /> : <ImagePlus size={18} strokeWidth={1.8} aria-hidden="true" />}
            {ownActive ? <Check className="kun-account-avatar-check" size={10} strokeWidth={3} aria-hidden="true" /> : null}
          </span>
          <span className="kun-account-avatar-label">{own ? t('kunAccountAvatarOwn') : t('kunAccountAvatarUpload')}</span>
        </button>
        <button type="button" role="radio" aria-checked={!ownActive} className="kun-account-avatar-option" data-kun-avatar-option="kun"
          onClick={() => setAccountAvatarSource('kun')}>
          <span className="kun-account-avatar-preview">
            <RoomAvatar user id="user" label="" size={44} />
            {!ownActive ? <Check className="kun-account-avatar-check" size={10} strokeWidth={3} aria-hidden="true" /> : null}
          </span>
          <span className="kun-account-avatar-label">{t('kunAccountAvatarKun')}</span>
        </button>
      </div>
      <div className="kun-account-avatar-foot">
        <p role={invalid ? 'alert' : undefined} data-tone={invalid ? 'bad' : undefined}>{hint}</p>
        {ownActive ? (
          <span className="kun-account-avatar-links">
            <button type="button" onClick={upload}>{t('kunAccountAvatarReplace')}</button>
            {value.custom ? (
              <button type="button" onClick={() => setAccountAvatarCustom(null)}>
                {user.avatarUrl ? t('kunAccountAvatarUseAccount') : t('kunAccountAvatarRemove')}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <input ref={file} hidden type="file" accept={PICTURE_TYPES.join(',')} onChange={(event) => {
        const selected = event.target.files?.[0]
        event.target.value = ''
        if (selected) void choose(selected)
      }} />
    </section>
  )
}
