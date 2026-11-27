/** Only paw state and coarse desk zones cross IPC; physical keys and text stay out of this contract. */
export type PetKeyMask = 0 | 1 | 2 | 3
export type PetKeyZone = { col: number; row: number }
export type PetMouseButtons = number
export type PetTypingPaw = { sequence: number; struckAt: number; releasedAt: number; col?: number; row?: number }
export type PetTypingState = { held: PetKeyMask; left: PetTypingPaw; right: PetTypingPaw }

export const isPetKeyMask = (value: unknown): value is PetKeyMask =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3

export const isPetKeyZone = (value: unknown): value is PetKeyZone => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const zone = value as { col?: unknown; row?: unknown }
  return typeof zone.col === 'number' && Number.isInteger(zone.col) && zone.col >= 0 && zone.col <= 5 &&
    typeof zone.row === 'number' && Number.isInteger(zone.row) && zone.row >= 0 && zone.row <= 2
}

export const isPetMouseButtons = (value: unknown): value is PetMouseButtons =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7

export function emptyPetTyping(): PetTypingState {
  return { held: 0, left: { sequence: 0, struckAt: 0, releasedAt: 0 }, right: { sequence: 0, struckAt: 0, releasedAt: 0 } }
}

export function updatePetTyping(
  previous: PetTypingState | undefined,
  held: PetKeyMask,
  tap: PetKeyMask,
  now: number,
  zone?: PetKeyZone
): PetTypingState {
  const state = previous ?? emptyPetTyping()
  const paw = (value: PetTypingPaw, mask: 1 | 2): PetTypingPaw => {
    const struck = Boolean(tap & mask)
    const nextZone = struck && zone
      ? tap === 3
        ? { col: mask === 1 ? 2 : 3, row: 2 }
        : { col: mask === 1 ? Math.min(2, Math.max(0, zone.col)) : Math.min(5, Math.max(3, zone.col)), row: zone.row }
      : value.col !== undefined && value.row !== undefined
        ? { col: value.col, row: value.row }
        : undefined
    return {
      sequence: value.sequence + (struck ? 1 : 0),
      struckAt: struck ? now : value.struckAt,
      releasedAt: state.held & mask && !(held & mask) ? now : value.releasedAt,
      ...(nextZone ?? {})
    }
  }
  return { held, left: paw(state.left, 1), right: paw(state.right, 2) }
}

const LEFT_ZONES: Record<string, PetKeyZone> = {
  Escape: { col: 0, row: 0 }, Backquote: { col: 0, row: 0 }, Digit1: { col: 0, row: 0 }, Digit2: { col: 0, row: 0 },
  Tab: { col: 0, row: 1 }, KeyQ: { col: 0, row: 0 }, KeyA: { col: 0, row: 1 }, KeyZ: { col: 0, row: 2 }, IntlBackslash: { col: 0, row: 2 },
  Digit3: { col: 1, row: 0 }, KeyW: { col: 1, row: 0 }, KeyE: { col: 1, row: 0 }, KeyS: { col: 1, row: 1 }, KeyD: { col: 1, row: 1 }, KeyX: { col: 1, row: 2 }, KeyC: { col: 1, row: 2 },
  Digit4: { col: 2, row: 0 }, Digit5: { col: 2, row: 0 }, KeyR: { col: 2, row: 0 }, KeyT: { col: 2, row: 0 }, KeyF: { col: 2, row: 1 }, KeyG: { col: 2, row: 1 }, KeyV: { col: 2, row: 2 }, KeyB: { col: 2, row: 2 }
}

const RIGHT_ZONES: Record<string, PetKeyZone> = {
  Digit6: { col: 3, row: 0 }, Digit7: { col: 3, row: 0 }, KeyY: { col: 3, row: 0 }, KeyU: { col: 3, row: 0 }, KeyH: { col: 3, row: 1 }, KeyJ: { col: 3, row: 1 }, KeyN: { col: 3, row: 2 }, KeyM: { col: 3, row: 2 },
  Digit8: { col: 4, row: 0 }, Digit9: { col: 4, row: 0 }, KeyI: { col: 4, row: 0 }, KeyO: { col: 4, row: 0 }, KeyK: { col: 4, row: 1 }, KeyL: { col: 4, row: 1 }, Comma: { col: 4, row: 2 }, Period: { col: 4, row: 2 },
  Digit0: { col: 5, row: 0 }, Minus: { col: 5, row: 0 }, Equal: { col: 5, row: 0 }, Backspace: { col: 5, row: 0 }, Delete: { col: 5, row: 0 }, Insert: { col: 5, row: 0 }, Home: { col: 5, row: 0 }, PageUp: { col: 5, row: 0 }, IntlYen: { col: 5, row: 0 },
  KeyP: { col: 5, row: 0 }, BracketLeft: { col: 5, row: 0 }, BracketRight: { col: 5, row: 0 }, Backslash: { col: 5, row: 1 }, Semicolon: { col: 5, row: 1 }, Quote: { col: 5, row: 1 }, Enter: { col: 5, row: 1 }, End: { col: 5, row: 1 }, PageDown: { col: 5, row: 1 },
  Slash: { col: 5, row: 2 }, IntlRo: { col: 5, row: 2 }, ArrowUp: { col: 5, row: 1 }, ArrowDown: { col: 5, row: 2 }, ArrowLeft: { col: 4, row: 2 }, ArrowRight: { col: 5, row: 2 }
}

const LEFT_CODES = new Set(Object.keys(LEFT_ZONES))
const RIGHT_CODES = new Set([
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote',
  'Comma', 'Period', 'Slash', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
  'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'IntlRo', 'IntlYen'
])

/** Coarse 6x3 spatial bucket for physical key placement; merges multiple keys per cell. */
export function petTypingZoneForCode(code: string): PetKeyZone | undefined {
  if (code === 'Space') return { col: 2, row: 2 }
  if (LEFT_ZONES[code]) return LEFT_ZONES[code]
  if (RIGHT_ZONES[code]) return RIGHT_ZONES[code]
  if (/^Numpad[789]|Numpad(?:Divide|Multiply|Subtract)$/.test(code)) return { col: 5, row: 0 }
  if (/^Numpad[456]|NumpadAdd$/.test(code)) return { col: 5, row: 1 }
  if (/^Numpad(?:[0123]|Decimal|Enter|Equal)$/.test(code)) return { col: 5, row: 2 }
  return undefined
}

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
