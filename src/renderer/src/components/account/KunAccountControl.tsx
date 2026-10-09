import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { bodyZoom } from '../../lib/body-zoom'
import { useKunAccount, type KunAccountAction } from './useKunAccount'
import { KunAccountPanel, KunAccountPanelClose } from './KunAccountPanel'
import { kunAccountBadge, kunAccountEntry, kunAccountPanelPlacement, kunAccountView } from './kun-account-view'
import './kun-account.css'
import { KunAccountAvatar } from './KunAccountAvatar'

const WELCOME_MS = 2400

/**
 * The sidebar's Kun account entry: "Sign in" beside Kun's card, the account
 * initial once signed in, and a panel that follows the browser sign-in live.
 * `row` is the full-width form used when the footer has no Kun card.
 */
export function KunAccountControl({ variant = 'chip' }: { variant?: 'chip' | 'row' }): ReactElement | null {
  const { t } = useTranslation('common')
  const { state, busy, welcome, notice, dismissWelcome, run, api } = useKunAccount()
  const [open, setOpen] = useState(false)
  const [reopened, setReopened] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [manageFailed, setManageFailed] = useState(false)
  const [placement, setPlacement] = useState<CSSProperties>({})
  const [hovered, setHovered] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Only an open the user asked for moves focus; a sign-in finishing never does.
  const focusOnOpen = useRef(false)
  const panelId = useId()
  const titleId = useId()
  const view = kunAccountView(state, welcome)
  const entry = kunAccountEntry(state)
  const badge = kunAccountBadge(state)
  const visible = open && view !== 'none'

  const close = useCallback((refocus = true) => {
    setOpen(false)
    dismissWelcome()
    if (refocus) trigger.current?.focus()
  }, [dismissWelcome])

  // A finished or failed browser sign-in opens the panel without taking focus.
  useEffect(() => { if (notice) setOpen(true) }, [notice])
  useEffect(() => { if (view !== 'waiting') setReopened(false) }, [view])
  useEffect(() => { if (!open) { setRefreshed(false); setManageFailed(false) } }, [open])

  useEffect(() => {
    if (view !== 'welcome' || !open || hovered) return
    const timer = window.setTimeout(() => close(false), WELCOME_MS)
    return () => window.clearTimeout(timer)
  }, [view, open, hovered, close])

  useLayoutEffect(() => {
    if (!visible) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const next = kunAccountPanelPlacement({ anchor: rect, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, scale: bodyZoom() })
      setPlacement({ left: next.left, bottom: next.bottom, width: next.width, maxHeight: next.maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [visible, view])

  useEffect(() => {
    if (!visible || !focusOnOpen.current) return
    focusOnOpen.current = false
    const frame = window.requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>('.kun-account-view button:not(:disabled)')?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [visible, close])

  if (!api || window.kunGui?.isRemoteWeb) return null

  const act = (action: KunAccountAction) => {
    if (action === 'reopenLogin') setReopened(true)
    if (action === 'refresh') setRefreshed(false)
    void run(action).then(() => {
      if (action === 'refresh') setRefreshed(true)
      // The pressed row is gone; hand focus back to the entry.
      if (action === 'logout' || action === 'cancelLogin') close()
    })
  }
  const onEntry = () => {
    focusOnOpen.current = !open
    if (entry === 'login') {
      setOpen(true)
      act('login')
      return
    }
    if (open) close(false)
    else setOpen(true)
  }
  const manage = () => {
    setManageFailed(false)
    void api.openAccountCenter().then(() => close(false), () => setManageFailed(true))
  }

  const user = state.user
  const label = entry === 'avatar' && user
    ? t('kunAccountOpenMenu', { name: user.name })
    : entry === 'busy' ? t('kunAccountSigningIn') : t('kunAccountSignInLabel')
  const content = entry === 'avatar' && user ? (
    <>
      <KunAccountAvatar user={user} size={variant === 'row' ? 24 : 30} />
      {variant === 'row' ? <span className="kun-account-entry-text">{user.name}</span> : null}
    </>
  ) : entry === 'busy' ? (
    <><span className="kun-account-spinner" aria-hidden="true" /><span className="kun-account-entry-text">{t('kunAccountSigningIn')}</span></>
  ) : entry === 'loading' ? (
    <span className="kun-account-skeleton" aria-hidden="true" />
  ) : (
    <><LogIn size={14} aria-hidden="true" /><span className="kun-account-entry-text">{variant === 'row' ? t('kunAccountSignInLabel') : t('kunAccountSignIn')}</span></>
  )

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="kun-account-entry"
        data-kun-account-login
        data-entry={entry}
        data-variant={variant}
        data-badge={badge === 'none' ? undefined : badge}
        aria-label={label}
        title={user ? `${user.name} · ${user.email}` : label}
        aria-haspopup="dialog"
        aria-expanded={visible}
        aria-controls={visible ? panelId : undefined}
        disabled={entry === 'loading'}
        onClick={onEntry}
      >
        {content}
        {badge === 'none' ? null : <i className="kun-account-badge" aria-hidden="true" />}
      </button>
      {visible ? createPortal(
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="kun-account-panel"
          data-view={view}
          style={placement}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <KunAccountPanelClose onClose={() => close()} />
          <KunAccountPanel
            view={view}
            state={state}
            busy={busy}
            platform={window.kunGui?.platform ?? ''}
            reopened={reopened}
            refreshed={refreshed}
            manageFailed={manageFailed}
            titleId={titleId}
            onAction={act}
            onManage={manage}
            onClose={() => close()}
          />
        </div>,
        document.body
      ) : null}
    </>
  )
}
