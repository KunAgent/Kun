export type PetGlobalActivityPreferences = { keyboard: boolean; microphone: boolean }
export type PetGlobalActivityState = 'off' | 'starting' | 'active' | 'paused' | 'permission-required' | 'unsupported' | 'unavailable'
export type PetGlobalActivityStatus = {
  keyboard: PetGlobalActivityState
  microphone: PetGlobalActivityState
  recording: boolean
}

export function defaultPetGlobalActivity(): PetGlobalActivityPreferences {
  return { keyboard: false, microphone: false }
}

export function parsePetGlobalActivity(value: unknown): PetGlobalActivityPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.keyboard !== 'boolean' || typeof input.microphone !== 'boolean') return null
  return { keyboard: input.keyboard, microphone: input.microphone }
}

export type PetNativeActivityEvent =
  | { type: 'typing' }
  | { type: 'recording'; active: boolean }
  | { type: 'status'; keyboard: PetGlobalActivityState; microphone: PetGlobalActivityState }

/** Whitelist the entire wire format; arbitrary native data cannot reach the renderer. */
export function parsePetNativeActivity(line: string): PetNativeActivityEvent | null {
  if (line.length > 512) return null
  try {
    const value = JSON.parse(line)
    if (!value || typeof value !== 'object') return null
    if (value.type === 'typing') return { type: 'typing' }
    if (value.type === 'recording' && typeof value.active === 'boolean') return { type: 'recording', active: value.active }
    const states = ['off', 'active', 'permission-required', 'unsupported', 'unavailable']
    if (value.type === 'status' && states.includes(value.keyboard) && states.includes(value.microphone)) {
      return { type: 'status', keyboard: value.keyboard, microphone: value.microphone }
    }
  } catch { /* Ignore malformed events. */ }
  return null
}
