/**
 * Renderer-neutral key event. It is structurally compatible with opentui's
 * parsed KeyEvent so the terminal application can pass events straight
 * through, while keymap parsing and dialog state stay importable from code
 * that must not load the native renderer (the `kun serve` process).
 */
export type TuiKeyEvent = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option?: boolean
  super?: boolean
  eventType?: 'press' | 'repeat' | 'release'
  sequence?: string
}

export type TuiKeyEventType = 'press' | 'repeat' | 'release'

const NAME_ALIASES: Record<string, string> = {
  return: 'enter',
  enter: 'enter',
  esc: 'escape',
  escape: 'escape',
  pageup: 'pageUp',
  pagedown: 'pageDown',
  ' ': 'space',
  space: 'space',
  del: 'delete',
  delete: 'delete',
  backspace: 'backspace',
  tab: 'tab',
  linefeed: 'enter'
}

export type ParsedKeyId = {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  super: boolean
}

export function parseKeyId(id: string): ParsedKeyId | undefined {
  const parts = id.split('+')
  const rawKey = parts.at(-1)
  if (!rawKey) return undefined
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()))
  return {
    key: normalizeName(rawKey),
    ctrl: modifiers.has('ctrl'),
    shift: modifiers.has('shift'),
    alt: modifiers.has('alt'),
    super: modifiers.has('super')
  }
}

function normalizeName(name: string): string {
  if (name === 'pageUp' || name === 'pageDown') return name
  const lower = name.toLowerCase()
  return NAME_ALIASES[lower] ?? lower
}

/** Canonical key name plus modifiers for one parsed terminal event. */
export function describeKey(event: TuiKeyEvent): ParsedKeyId {
  let key = normalizeName(event.name || '')
  let ctrl = event.ctrl
  // Legacy terminals encode Ctrl+J as a bare line feed. Keep that distinct
  // from Enter so the composer's Ctrl+J newline binding still works.
  if (event.name === 'linefeed') {
    key = 'j'
    ctrl = true
  }
  return {
    key,
    ctrl,
    shift: event.shift,
    alt: event.meta || Boolean(event.option),
    super: Boolean(event.super)
  }
}

export function matchesKey(event: TuiKeyEvent, id: string): boolean {
  const target = parseKeyId(id)
  if (!target) return false
  const actual = describeKey(event)
  if (actual.key !== target.key) return false
  if (actual.ctrl !== target.ctrl || actual.alt !== target.alt || actual.super !== target.super) return false
  if (actual.shift === target.shift) return true
  // Shifted symbols ("?", "G") already encode shift in the character itself.
  return !target.shift && target.key.length === 1 && !/[a-z0-9]/u.test(target.key)
}

export function keyEventType(event: TuiKeyEvent): TuiKeyEventType {
  return event.eventType ?? 'press'
}

/** Printable text carried by a key press, excluding chords and escapes. */
export function printableText(event: TuiKeyEvent): string | undefined {
  if (event.ctrl || event.meta || event.option || event.super) return undefined
  if (keyEventType(event) === 'release') return undefined
  const sequence = event.sequence ?? ''
  if (sequence && !sequence.includes('\x1b') && Array.from(sequence).every((char) => char.codePointAt(0)! >= 0x20 && char !== '\x7f')) {
    return sequence
  }
  if (event.name === 'space') return ' '
  if (Array.from(event.name).length === 1) return event.shift ? event.name.toUpperCase() : event.name
  return undefined
}

/** True for Escape and Ctrl+C, the contextual "back" gesture on every page. */
export function isCancelKey(event: TuiKeyEvent): boolean {
  return matchesKey(event, 'escape') || matchesKey(event, 'ctrl+c')
}

export function isKey(event: TuiKeyEvent, ...ids: string[]): boolean {
  return ids.some((id) => matchesKey(event, id))
}

/** Plain lowercase character for single-letter page shortcuts ("y", "f"). */
export function letter(event: TuiKeyEvent): string | undefined {
  if (event.ctrl || event.meta || event.option || event.super) return undefined
  const text = printableText(event)
  return text && Array.from(text).length === 1 ? text.toLowerCase() : undefined
}
