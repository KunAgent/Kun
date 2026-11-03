import { parseKeypress } from '@opentui/core'
import type { TuiKeyEvent } from './keys.js'

/** Parse a raw terminal sequence into the key event the app receives. */
export function key(sequence: string): TuiKeyEvent {
  const parsed = parseKeypress(sequence, { useKittyKeyboard: true })
  if (!parsed) throw new Error(`unparsed key ${JSON.stringify(sequence)}`)
  return parsed
}

/** Named keys used across page and session tests. */
export const keys = {
  enter: key('\r'),
  escape: key('\x1b'),
  ctrlC: key('\x03'),
  up: key('\x1b[A'),
  down: key('\x1b[B'),
  left: key('\x1b[D'),
  right: key('\x1b[C'),
  pageUp: key('\x1b[5~'),
  pageDown: key('\x1b[6~'),
  backspace: key('\x7f'),
  tab: key('\t'),
  space: key(' ')
} as const

export function typeText(target: { handleKey(key: TuiKeyEvent): void }, text: string): void {
  for (const char of Array.from(text)) target.handleKey(key(char))
}
