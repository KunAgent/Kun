import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { bodyZoom } from '../../lib/body-zoom'
import { useChatStore } from '../../store/chat-store'
import { openWardrobePage } from '../wardrobe/wardrobe-route'
import type { WardrobeTabRequest } from '../wardrobe/wardrobe-tab-request'
import { useKunAccount, type KunAccountAction } from './useKunAccount'
import { KunAccountPanel, KunAccountPanelClose } from './KunAccountPanel'
import { KunAccountGuestMenu, KunAccountMenu } from './KunAccountMenu'
import { SidebarAccountCard } from './SidebarAccountCard'
import { kunAccountPanelPlacement, kunAccountView } from './kun-account-view'
import './kun-account.css'
import './kun-account-card.css'

const WELCOME_MS = 2400

/** The desktop app has the account bridge; the remote browser client does not. */
export function kunAccountAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.kunGui?.kunAccount) && !window.kunGui?.isRemoteWeb
}

/**
 * The sidebar's Kun account: the footer card is the account, and its menu holds the wardrobe,
 * the shop, invitations and the account itself. The same panel follows the browser sign-in live.
 * `compact` is the one-line form for theme packs with their own sidebar scene. In the footer dock the
 * card carries Settings (`accessory`) and the menu lists it too (`onOpenSettings`).
 */
export function KunAccountControl({ variant = 'card', accessory, onOpenSettings }: {
  variant?: 'card' | 'compact' | 'mini'
  accessory?: ReactNode
  onOpenSettings?: () => void
}): ReactElement | null {
  const { state, busy, welcome, notice, dismissWelcome, run, api } = useKunAccount()
  const [open, setOpen] = useState(false)
  // Set while the panel was opened by a failed sign-in; it explains the failure once.
  const [failure, setFailure] = useState(false)
  const [reopened, setReopened] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [manageFailed, setManageFailed] = useState(false)
  const [placement, setPlacement] = useState<CSSProperties>({})
  const [hovered, setHovered] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Only an open the user asked for moves focus; a sign-in finishing never does.
  const focusOnOpen = useRef(false)
  const panelId = useId()
  const titleId = useId()
  const view = kunAccountView(state, welcome, failure)
  const visible = open && view !== 'none'

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setFailure(false)
    dismissWelcome()
    if (refocus) trigger.current?.focus()
  }, [dismissWelcome])

  // A finished or failed browser sign-in opens the panel without taking focus.
  useEffect(() => {
    // The first-run guide shows its own sign-in result; do not pop over it.
    if (!notice || useChatStore.getState().initialSetupOpen) return
    setOpen(true)
    setFailure(notice.kind === 'failure')
  }, [notice])
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
      const rect = card.current?.getBoundingClientRect()
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
      if (!panel.current?.contains(target) && !card.current?.contains(target)) close(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [visible, close])

  if (!api || window.kunGui?.isRemoteWeb) return null
  // The Focus mode face is only for a signed-in account; signed out, Focus mode stays quiet.
  if (variant === 'mini' && !state.user) return null

  const act = (action: KunAccountAction) => {
    if (action === 'reopenLogin') setReopened(true)
    if (action === 'refresh') setRefreshed(false)
    if (action === 'login') setFailure(false)
    void run(action).then(() => {
      if (action === 'refresh') setRefreshed(true)
      // The pressed row is gone; hand focus back to the card.
      if (action === 'logout' || action === 'cancelLogin') close()
    })
  }
  const toggle = () => {
    if (open) { close(false); return }
    focusOnOpen.current = true
    setFailure(false)
    setOpen(true)
  }
  const login = () => {
    focusOnOpen.current = true
    setOpen(true)
    act('login')
  }
  const manage = () => {
    setManageFailed(false)
    void api.openAccountCenter().then(() => close(false), () => setManageFailed(true))
  }
  const navigate = (tab: WardrobeTabRequest) => {
    close(false)
    openWardrobePage(tab)
  }
  // Up and down walk the menu's buttons, wrapping at either end.
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('.kun-account-view button:not(:disabled)') ?? [])]
    if (!buttons.length) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    buttons[(index + step + buttons.length) % buttons.length]?.focus()
  }
  const platform = window.kunGui?.platform ?? ''

  return (
    <>
      <SidebarAccountCard
        variant={variant}
        state={state}
        open={visible}
        panelId={panelId}
        cardRef={card}
        triggerRef={trigger}
        onToggle={toggle}
        onLogin={login}
        accessory={accessory}
      />
      {visible ? createPortal(
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="kun-account-panel"
          data-view={view}
          style={placement}
          onKeyDown={walk}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          {view === 'menu' ? (
            <KunAccountMenu state={state} busy={busy} titleId={titleId} platform={platform} refreshed={refreshed} manageFailed={manageFailed}
              onAction={act} onNavigate={navigate} onManage={manage}
              onOpenSettings={onOpenSettings ? () => { close(false); onOpenSettings() } : undefined} />
          ) : view === 'guest' ? (
            <>
              <KunAccountPanelClose onClose={() => close()} />
              <KunAccountGuestMenu state={state} busy={busy} titleId={titleId} platform={platform} onAction={act} onNavigate={navigate} />
            </>
          ) : (
            <>
              <KunAccountPanelClose onClose={() => close()} />
              <KunAccountPanel view={view} state={state} busy={busy} platform={platform} reopened={reopened} titleId={titleId}
                onAction={act} onClose={() => close()} />
            </>
          )}
        </div>,
        document.body
      ) : null}
    </>
  )
}
