import { useEffect, useState, type ReactElement } from 'react'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { signInToKun } from './wardrobe-account'

function useSigningIn(): [boolean, () => void] {
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    if (!waiting) return
    // The browser sign-in can be abandoned; the button comes back after a while.
    const timer = setTimeout(() => setWaiting(false), 20_000)
    return () => clearTimeout(timer)
  }, [waiting])
  return [waiting, () => { setWaiting(true); signInToKun() }]
}

/** Signed out, the bottle shelf becomes the reason to sign in. */
export function WardrobeGuestCard(): ReactElement {
  const { t } = useTranslation('common')
  const [waiting, signIn] = useSigningIn()
  return <section className="kun-wardrobe-guest" aria-label={t('wardrobeAccountGuestTitle')} data-wardrobe-guest>
    <div className="kun-wardrobe-guest-head">
      <WardrobeBottleIcon size={46} state="sealed" />
      <span className="kun-wardrobe-guest-text">
        <strong>{t('wardrobeAccountGuestTitle')}</strong>
        <small>{t('wardrobeAccountGuestBody')}</small>
      </span>
    </div>
    <button type="button" className="kun-wardrobe-guest-sign-in" disabled={waiting} onClick={signIn} data-wardrobe-sign-in>
      {waiting ? t('wardrobeAccountSigningIn') : t('wardrobeAccountSignIn')}
    </button>
    <p>{t('wardrobeAccountInviteHint')}</p>
  </section>
}

/** The shop and invitation tabs while signed out. */
export function WardrobeLockedPanel({ kind }: { kind: 'shop' | 'invite' }): ReactElement {
  const { t } = useTranslation('common')
  const [waiting, signIn] = useSigningIn()
  return <div className="kun-wardrobe-scroll kun-wardrobe-locked" data-wardrobe-locked={kind}>
    <span className="kun-wardrobe-locked-icon" aria-hidden="true"><Lock size={20} strokeWidth={1.8} /></span>
    <strong>{t(kind === 'shop' ? 'wardrobeAccountLockedShopTitle' : 'wardrobeAccountLockedInviteTitle')}</strong>
    <p>{t('wardrobeAccountLockedBody')}</p>
    <button type="button" className="kun-wardrobe-guest-sign-in" disabled={waiting} onClick={signIn}>
      {waiting ? t('wardrobeAccountSigningIn') : t('wardrobeAccountSignIn')}
    </button>
  </div>
}
