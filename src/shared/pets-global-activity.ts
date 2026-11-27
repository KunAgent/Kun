import { isPetKeyMask, isPetKeyZone, isPetMouseButtons, type PetKeyMask, type PetKeyZone, type PetMouseButtons } from './pets-typing'
export type PetGlobalActivityPreferences = { keyboard: boolean; microphone: boolean }
export type PetGlobalActivityState = 'off' | 'starting' | 'active' | 'paused' | 'permission-required' | 'unsupported' | 'unavailable'
export type PetGlobalActivityStatus = {
  keyboard: PetGlobalActivityState
  microphone: PetGlobalActivityState
  recording: boolean
}

export function defaultPetGlobalActivity(): PetGlobalActivityPreferences {
  // Recording detection watches every app on the machine, not just Kun, so it
  // stays opt-in: a default-on system-wide "listening" reaction reads as Kun
  // capturing the microphone.
  return { keyboard: true, microphone: false }
}

export function parsePetGlobalActivityPreferences(value: unknown): PetGlobalActivityPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.keyboard !== 'boolean' || typeof candidate.microphone !== 'boolean') return null
  return { keyboard: candidate.keyboard, microphone: candidate.microphone }
}

export type PetNativeActivityEvent =
  | { type: 'keys'; sequence: number; held: PetKeyMask; tap: PetKeyMask; zone?: PetKeyZone }
  | { type: 'mouse'; sequence: number; buttons: PetMouseButtons; wheel: -1 | 0 | 1 }
  | { type: 'typing' }
  | { type: 'recording'; active: boolean }
  | { type: 'status'; keyboard: PetGlobalActivityState; microphone: PetGlobalActivityState }

/** Whitelist the entire wire format; arbitrary native data cannot reach the renderer. */
export function parsePetNativeActivity(line: string): PetNativeActivityEvent | null {
  if (line.length > 512) return null
  try {
    const value = JSON.parse(line)
    if (!value || typeof value !== 'object') return null
    if (value.type === 'keys' && Number.isSafeInteger(value.sequence) && value.sequence > 0 && isPetKeyMask(value.held) && isPetKeyMask(value.tap)) {
      const zone = isPetKeyZone(value.zone) ? { col: value.zone.col, row: value.zone.row } : undefined
      return { type: 'keys', sequence: value.sequence, held: value.held, tap: value.tap, ...(zone ? { zone } : {}) }
    }
    if (value.type === 'mouse' && Number.isSafeInteger(value.sequence) && value.sequence > 0 &&
      isPetMouseButtons(value.buttons) && (value.wheel === -1 || value.wheel === 0 || value.wheel === 1)) {
      return { type: 'mouse', sequence: value.sequence, buttons: value.buttons, wheel: value.wheel }
    }
    if (value.type === 'typing') return { type: 'typing' }
    if (value.type === 'recording' && typeof value.active === 'boolean') return { type: 'recording', active: value.active }
    const states = ['off', 'active', 'permission-required', 'unsupported', 'unavailable']
    if (value.type === 'status' && states.includes(value.keyboard) && states.includes(value.microphone)) {
      return { type: 'status', keyboard: value.keyboard, microphone: value.microphone }
    }
  } catch { /* Ignore malformed events. */ }
  return null
}
