import {
  useCallback,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { InterruptArmingContext, interruptArmDeadline } from './interrupt-arming'
import '../composer-tray/composer-tray.css'
import './interrupt-card.css'

/*
 * Interrupt card shell: the section that takes the composer shell's place,
 * with the focus (autofocus / parking) and click-arming rules every card
 * inherits, plus the scrolling body region. Re-exported from
 * ./interrupt-card-primitives together with the rest of the building blocks.
 */

export type InterruptCardProps = Omit<HTMLAttributes<HTMLElement>, 'onKeyDown'> & {
  /** Accessible name of the card region ("Kun 的提问", "需要你的批准"). */
  ariaLabel: string
  /** `data-composer-stack-item` value (keep 'user-input' / 'approval' for smoke). */
  marker?: string
  /** Side conversation / narrow composer density. */
  compact?: boolean
  /** Usually `navigation.onKeyDown` from useInterruptOptionNavigation. */
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void
  /**
   * Move focus into the card on mount and whenever `focusKey` changes (to the
   * first `[data-interrupt-autofocus]`, else the card) when focus is on the
   * page body or inside the same composer. Never steals focus from an editor
   * elsewhere on the page; focus coming from the composer's own editor parks
   * on the card instead (see InterruptCard).
   */
  autoFocus?: boolean
  /**
   * The request / question on screen (e.g. the question id or approval id).
   * A change re-arms the card's clicks and re-runs autofocus with the same
   * guard; focus already inside the card moves to the new request's
   * autofocus target, so paging to a question without options lands in its
   * free-text row.
   */
  focusKey?: unknown
  children: ReactNode
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'])
const isWakeKey = (event: ReactKeyboardEvent<HTMLElement>): boolean =>
  !event.metaKey && !event.ctrlKey && !event.altKey &&
  (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape' || /^[0-9]$/.test(event.key))

/**
 * Card shell. Safety rules that every card inherits:
 * - Arming: clicks on option rows and footer buttons are ignored for
 *   INTERRUPT_ARM_DELAY_MS after mount and after each `focusKey` change, so
 *   a click aimed at the composer (or the second half of a double click on
 *   the previous request) never decides the new one.
 * - Parking: when the card appears while the user is typing in the composer,
 *   focus parks on the card itself instead of the option list. The first
 *   Enter / Space / digit / Esc only wakes the card (moves focus to its
 *   autofocus target) and decides nothing; arrows, Tab or a click work as
 *   usual. Focus is read in a layout effect, before the hidden editor loses it.
 */
export function InterruptCard({
  ariaLabel,
  marker,
  compact = false,
  onKeyDown,
  autoFocus = true,
  focusKey,
  className,
  onPointerDown,
  children,
  ...rest
}: InterruptCardProps): ReactElement {
  const rootRef = useRef<HTMLElement | null>(null)
  const mountedRef = useRef(false)
  const parkedRef = useRef(false)
  const armedAtRef = useRef(Number.POSITIVE_INFINITY)
  const isArmed = useCallback(() => Date.now() >= armedAtRef.current, [])
  const focusTarget = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    parkedRef.current = false
    const target = root.querySelector<HTMLElement>('[data-interrupt-autofocus]') ?? root
    target.focus({ preventScroll: true })
  }, [])
  useLayoutEffect(() => {
    armedAtRef.current = interruptArmDeadline(Date.now())
    const firstRun = !mountedRef.current
    mountedRef.current = true
    const root = rootRef.current
    if (!autoFocus || !root || typeof document === 'undefined') return
    const active = document.activeElement
    if (active && root.contains(active)) {
      // A new request inside the same card starts from its list / free text,
      // unless the card is still parked from the composer.
      if (firstRun || (active === root && parkedRef.current)) return
      if (active !== root.querySelector('[data-interrupt-autofocus]')) focusTarget()
      return
    }
    const host = root.closest('[data-floating-composer]') ?? root.parentElement
    const focusIsFree = !active || active === document.body || Boolean(host?.contains(active))
    if (!focusIsFree) return
    if (active instanceof HTMLElement && active.closest(EDITABLE_SELECTOR)) {
      parkedRef.current = true
      root.focus({ preventScroll: true })
      return
    }
    focusTarget()
    // Mount + request changes only: re-running on other prop changes would
    // yank focus back mid-answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (parkedRef.current && event.target === rootRef.current && !event.defaultPrevented) {
      if (isWakeKey(event)) {
        event.preventDefault()
        focusTarget()
        return
      }
      if (NAVIGATION_KEYS.has(event.key)) parkedRef.current = false
    }
    onKeyDown?.(event)
  }
  return (
    <InterruptArmingContext.Provider value={isArmed}>
      <section
        {...rest}
        ref={rootRef}
        tabIndex={-1}
        aria-label={ariaLabel}
        className={`ds-interrupt-card ds-no-drag ${className ?? ''}`.trim()}
        data-composer-stack-item={marker}
        data-compact={compact ? 'true' : undefined}
        onKeyDown={handleKeyDown}
        onPointerDown={(event: ReactPointerEvent<HTMLElement>) => {
          parkedRef.current = false
          onPointerDown?.(event)
        }}
      >
        {children}
      </section>
    </InterruptArmingContext.Provider>
  )
}

/**
 * Scrolling middle of a tall card (long previews, many options): header,
 * question and footer stay put while this region scrolls. The card caps its
 * height at 70dvh. Extra props pass through (e.g. data-approval-evidence-scroll).
 */
export function InterruptCardBody({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div {...rest} className={`ds-interrupt-card-body ${className ?? ''}`.trim()}>
      {children}
    </div>
  )
}
