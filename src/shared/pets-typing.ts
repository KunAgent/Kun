/** Only paw state crosses IPC; physical keys and text stay out of this contract. */
export type PetKeyMask = 0 | 1 | 2 | 3
export type PetTypingPaw = { sequence: number; struckAt: number; releasedAt: number }
export type PetTypingState = { held: PetKeyMask; left: PetTypingPaw; right: PetTypingPaw }

export const isPetKeyMask = (value: unknown): value is PetKeyMask =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3

export function emptyPetTyping(): PetTypingState {
  return { held: 0, left: { sequence: 0, struckAt: 0, releasedAt: 0 }, right: { sequence: 0, struckAt: 0, releasedAt: 0 } }
}

export function updatePetTyping(previous: PetTypingState | undefined, held: PetKeyMask, tap: PetKeyMask, now: number): PetTypingState {
  const state = previous ?? emptyPetTyping()
  const paw = (value: PetTypingPaw, mask: number): PetTypingPaw => ({
    sequence: value.sequence + (tap & mask ? 1 : 0),
    struckAt: tap & mask ? now : value.struckAt,
    releasedAt: state.held & mask && !(held & mask) ? now : value.releasedAt
  })
  return { held, left: paw(state.left, 1), right: paw(state.right, 2) }
}

const LEFT_CODES = new Set([
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'Backquote', 'Tab', 'Escape', 'IntlBackslash'
])
const RIGHT_CODES = new Set([
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote',
  'Comma', 'Period', 'Slash', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
  'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'IntlRo', 'IntlYen'
])

/** Physical location only, independent of the character produced by an IME/layout. */
export function petTypingMaskForCode(code: string): PetKeyMask {
  if (code === 'Space') return 3
  if (LEFT_CODES.has(code)) return 1
  if (/^(Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal))$/.test(code) || RIGHT_CODES.has(code)) return 2
  return 0
}

export class PetKeyboardState {
  private readonly pressed = new Map<string, PetKeyMask>()
  get held(): PetKeyMask { return [...this.pressed.values()].reduce<number>((mask, value) => mask | value, 0) as PetKeyMask }
  down(code: string, repeat = false): { held: PetKeyMask; tap: PetKeyMask } | null {
    const mask = petTypingMaskForCode(code)
    if (!mask || this.pressed.has(code)) return null
    if (this.pressed.size >= 128) this.pressed.clear()
    this.pressed.set(code, mask)
    return { held: this.held, tap: repeat ? 0 : mask }
  }
  up(code: string): { held: PetKeyMask; tap: PetKeyMask } | null {
    if (!this.pressed.delete(code)) return null
    return { held: this.held, tap: 0 }
  }
  reset(): void { this.pressed.clear() }
}
