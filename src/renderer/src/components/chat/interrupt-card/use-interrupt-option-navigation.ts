import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import { INTERRUPT_ARM_DELAY_MS, interruptArmDeadline } from './interrupt-arming'

/**
 * Keyboard model shared by the ask-user and approval interrupt cards.
 *
 * Rows are the options (0..optionCount-1) followed by an optional free-text
 * row (index optionCount). Focus normally rests on the option listbox (rows
 * are aria-activedescendant targets, not tab stops); the free-text row owns
 * real focus in its textarea. Keys typed inside a text field are never
 * hijacked: digits and Space type, ↑ only leaves from the very start of the
 * text, Enter confirms unless Shift is held or an IME is composing.
 *
 * Decision keys (digits that pick an option, Enter, Space, Esc) are ignored
 * while the card is not armed yet (INTERRUPT_ARM_DELAY_MS after mount and
 * after every `resetKey` change) and when they are auto-repeats: a keystroke
 * meant for the composer must never decide a request. Ignored keys are still
 * marked handled so they do not type into a field or reach other layers.
 *
 * Typical wiring (approval card; the ask card is the same without the
 * trusted-activation wrapper):
 *
 *   const nav = useInterruptOptionNavigation({
 *     optionCount: rows.length, hasFreeText: true, resetKey: request.id,
 *     onDigit: (i, event) => runTrustedUserActivation(event, () => decide(i)),
 *     onConfirm: (i, event) => runTrustedUserActivation(event, () => decide(i)),
 *     onEscape: (event) => ...
 *   })
 *   <InterruptCard focusKey={request.id} onKeyDown={nav.onKeyDown} ...>
 *     <InterruptOptionList listboxRef={nav.listboxRef} activeIndex={nav.activeIndex}
 *       after={<InterruptFreeTextRow textareaRef={nav.freeTextRef}
 *         autoFocus={rows.length === 0}
 *         onFocus={() => nav.setActiveIndex(nav.freeTextIndex, { focus: false })} />}>
 *       {rows.map((row, i) => <InterruptOptionRow ... onSelect={(event) => {
 *         nav.setActiveIndex(i)
 *         runTrustedUserActivation(event, () => decide(i))
 *       }} />)}
 *     </InterruptOptionList>
 *   </InterruptCard>
 *
 * Do not add a window-level key listener next to this hook: it would run
 * outside the arming / repeat guards and double-handle digits.
 */

export type InterruptNavKey = {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  /** Auto-repeat of a held key: never decides anything. */
  repeat?: boolean
}

export type InterruptNavState = {
  activeIndex: number
  optionCount: number
  hasFreeText: boolean
  multiSelect: boolean
  /** Focus is in a text field (the free-text textarea or another input). */
  inTextField: boolean
  /** The caret is collapsed at offset 0 of that text field. */
  caretAtStart?: boolean
  /** Focus is on another control inside the card (footer / pager button). */
  onOtherControl?: boolean
  /** False until the arming delay has passed (default true). */
  armed?: boolean
}

export type InterruptNavAction =
  | { type: 'move'; index: number }
  | { type: 'digit'; index: number }
  | { type: 'confirm'; index: number }
  | { type: 'toggle'; index: number }
  | { type: 'escape' }
  /** A decision key that arrived disarmed or auto-repeated: swallow it. */
  | { type: 'ignore' }

export function interruptRowCount(optionCount: number, hasFreeText: boolean): number {
  return Math.max(0, optionCount) + (hasFreeText ? 1 : 0)
}

/** Pure key → action mapping (null: let the browser handle the key). */
export function resolveInterruptNavigationKey(
  event: InterruptNavKey,
  state: InterruptNavState
): InterruptNavAction | null {
  const action = resolveKeyAction(event, state)
  if (!action || action.type === 'move' || action.type === 'ignore') return action
  return event.repeat === true || state.armed === false ? { type: 'ignore' } : action
}

function resolveKeyAction(
  event: InterruptNavKey,
  state: InterruptNavState
): InterruptNavAction | null {
  if (event.isComposing || event.key === 'Process') return null
  if (event.key === 'Escape') return { type: 'escape' }
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  const count = interruptRowCount(state.optionCount, state.hasFreeText)
  if (count === 0) return null
  const active = Math.min(Math.max(0, state.activeIndex), count - 1)
  const freeTextIndex = state.hasFreeText ? state.optionCount : -1

  if (state.inTextField) {
    if (event.key === 'Enter' && !event.shiftKey) return { type: 'confirm', index: active }
    if (event.key === 'ArrowUp' && state.caretAtStart && active > 0) {
      return { type: 'move', index: active - 1 }
    }
    if (event.key === 'Tab' && event.shiftKey && active > 0) return { type: 'move', index: active - 1 }
    return null
  }

  if (/^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1
    if (index < state.optionCount) return { type: 'digit', index }
    if (index === freeTextIndex) return { type: 'move', index }
    return null
  }

  if (state.onOtherControl) return null

  switch (event.key) {
    case 'ArrowDown':
      return { type: 'move', index: Math.min(active + 1, count - 1) }
    case 'ArrowUp':
      return { type: 'move', index: Math.max(active - 1, 0) }
    case 'Home':
      return { type: 'move', index: 0 }
    case 'End':
      return { type: 'move', index: count - 1 }
    case 'Tab':
      if (event.shiftKey) return active > 0 ? { type: 'move', index: active - 1 } : null
      return active < count - 1 ? { type: 'move', index: active + 1 } : null
    case 'Enter':
      return { type: 'confirm', index: active }
    case ' ':
      return state.multiSelect && active < state.optionCount ? { type: 'toggle', index: active } : null
    default:
      return null
  }
}

const hasDom = (): boolean => typeof HTMLElement !== 'undefined'

function isTextField(target: EventTarget | null): boolean {
  if (!hasDom() || !(target instanceof HTMLElement)) return false
  return target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit'].includes(target.type)) ||
    target.isContentEditable
}

function caretAtStart(target: EventTarget | null): boolean {
  if (!hasDom()) return false
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return (target.selectionStart ?? 0) === 0 && (target.selectionEnd ?? 0) === 0
  }
  return false
}

function isOtherControl(target: EventTarget | null): boolean {
  if (!hasDom() || !(target instanceof HTMLElement)) return false
  if (target.closest('[data-interrupt-option]') || target.closest('[role="listbox"]')) return false
  return Boolean(target.closest('button, a[href], select, summary, [role="button"]'))
}

export type InterruptOptionNavigationOptions = {
  optionCount: number
  hasFreeText?: boolean
  multiSelect?: boolean
  /** Row that is active when the card (or `resetKey`) changes. Default 0. */
  initialIndex?: number
  /** Resets the active row, e.g. the current question / approval id. */
  resetKey?: unknown
  /** Ignore every key (submitting). */
  disabled?: boolean
  /** Decision keys stay disarmed this long after mount / a resetKey change. */
  armDelayMs?: number
  /*
   * Decision callbacks receive the triggering keydown so protected actions
   * can check it, e.g. `runTrustedUserActivation(event, () => decide(row))`.
   * They never fire for auto-repeats or before the card is armed.
   */
  /** Digit 1–9 picked option `index` (0-based), only when focus is not in a text field. */
  onDigit?: (index: number, event: ReactKeyboardEvent<HTMLElement>) => void
  /** Enter on the active row (free text included: index === optionCount). */
  onConfirm?: (activeIndex: number, event: ReactKeyboardEvent<HTMLElement>) => void
  /** Space on the active option in a multi-select question. */
  onToggle?: (activeIndex: number, event: ReactKeyboardEvent<HTMLElement>) => void
  /** Esc anywhere in the card (skip / deny / close). */
  onEscape?: (event: ReactKeyboardEvent<HTMLElement>) => void
}

export type InterruptOptionNavigation = {
  activeIndex: number
  /** optionCount when there is a free-text row, otherwise -1. */
  freeTextIndex: number
  isFreeTextActive: boolean
  /**
   * Moves the active row. With `focus` (default true) focus follows: the
   * free-text row focuses its textarea, any option focuses the listbox (so a
   * card whose focus was parked on its root, or on a footer button, continues
   * from the list).
   */
  setActiveIndex: (index: number, options?: { focus?: boolean }) => void
  /** Attach to InterruptOptionList (`listboxRef`). */
  listboxRef: RefObject<HTMLDivElement | null>
  /** Attach to InterruptFreeTextRow (`textareaRef`). */
  freeTextRef: RefObject<HTMLTextAreaElement | null>
  /** Spread on the InterruptCard root: handles keys bubbling from anywhere inside. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

export function useInterruptOptionNavigation({
  optionCount,
  hasFreeText = false,
  multiSelect = false,
  initialIndex = 0,
  resetKey,
  disabled = false,
  armDelayMs = INTERRUPT_ARM_DELAY_MS,
  onDigit,
  onConfirm,
  onToggle,
  onEscape
}: InterruptOptionNavigationOptions): InterruptOptionNavigation {
  const count = interruptRowCount(optionCount, hasFreeText)
  const freeTextIndex = hasFreeText ? optionCount : -1
  const [rawActiveIndex, setRawActiveIndex] = useState(initialIndex)
  const listboxRef = useRef<HTMLDivElement | null>(null)
  const freeTextRef = useRef<HTMLTextAreaElement | null>(null)
  const activeIndex = count === 0 ? 0 : Math.min(Math.max(0, rawActiveIndex), count - 1)

  useEffect(() => {
    setRawActiveIndex(initialIndex)
    // Only a new question / request resets the row; initialIndex is read once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  // Layout effect: armed before any keydown can be dispatched to the new card.
  const armedAtRef = useRef(Number.POSITIVE_INFINITY)
  useLayoutEffect(() => {
    armedAtRef.current = interruptArmDeadline(Date.now(), armDelayMs)
    // A new request re-arms; the delay is read once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const setActiveIndex = useCallback((index: number, options?: { focus?: boolean }) => {
    if (count === 0) return
    const next = Math.min(Math.max(0, index), count - 1)
    setRawActiveIndex(next)
    if (options?.focus === false || typeof document === 'undefined') return
    if (next === freeTextIndex) {
      freeTextRef.current?.focus({ preventScroll: true })
      return
    }
    const listbox = listboxRef.current
    if (listbox && document.activeElement !== listbox) listbox.focus({ preventScroll: true })
  }, [count, freeTextIndex])

  const handlers = useRef({ onDigit, onConfirm, onToggle, onEscape })
  handlers.current = { onDigit, onConfirm, onToggle, onEscape }

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled || event.defaultPrevented) return
    const target = event.target
    const inTextField = isTextField(target)
    const action = resolveInterruptNavigationKey({
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing || event.keyCode === 229,
      repeat: event.repeat
    }, {
      activeIndex,
      optionCount,
      hasFreeText,
      multiSelect,
      inTextField,
      caretAtStart: inTextField && caretAtStart(target),
      onOtherControl: !inTextField && isOtherControl(target),
      armed: Date.now() >= armedAtRef.current
    })
    if (!action) return
    event.preventDefault()
    const current = handlers.current
    if (action.type === 'ignore') return
    if (action.type === 'move') setActiveIndex(action.index)
    else if (action.type === 'digit') {
      setActiveIndex(action.index)
      current.onDigit?.(action.index, event)
    } else if (action.type === 'confirm') current.onConfirm?.(action.index, event)
    else if (action.type === 'toggle') current.onToggle?.(action.index, event)
    else current.onEscape?.(event)
  }, [activeIndex, disabled, hasFreeText, multiSelect, optionCount, setActiveIndex])

  return {
    activeIndex,
    freeTextIndex,
    isFreeTextActive: activeIndex === freeTextIndex,
    setActiveIndex,
    listboxRef,
    freeTextRef,
    onKeyDown
  }
}
