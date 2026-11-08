import { emptyPetTyping, type PetTypingState } from '@shared/pets-typing'

export type PawMotion = { down: number; glow: number }
export type TypingMotion = { left: PawMotion; right: PawMotion; moving: boolean }
type Spring = { position: number; velocity: number; token: string }
const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n))

/** Real edges drive two springs. A held key never starts an artificial tapping loop. */
export class PetTypingMotion {
  private readonly paws: [Spring, Spring] = [
    { position: 0, velocity: 0, token: '' }, { position: 0, velocity: 0, token: '' }
  ]
  private previous: number | null = null
  private frozen: TypingMotion = { left: { down: 0, glow: 0 }, right: { down: 0, glow: 0 }, moving: false }

  sample(input: PetTypingState | undefined, now: number, reduced = false, paused = false): TypingMotion {
    const state = input ?? emptyPetTyping()
    if (paused) { this.previous = now; return this.frozen }
    const previous = this.previous
    const elapsed = previous === null ? 1 / 60 : Math.max(0, now - previous) / 1000
    this.previous = now
    let moving = false
    const result = this.paws.map((spring, i): PawMotion => {
      const paw = i ? state.right : state.left, held = Boolean(state.held & (i ? 2 : 1))
      const age = paw.struckAt ? Math.max(0, now - paw.struckAt) : Infinity
      const token = `${paw.sequence}:${paw.struckAt}`
      const target = held || age < 70 ? 1 : 0
      const fresh = (token !== spring.token && age < 120) ||
        (previous !== null && paw.releasedAt >= previous && now - paw.releasedAt < 120)
      // A sleeping animation clock is normal while a key stays held. A fresh
      // release must still spring back; only stale activity is snapped on resume.
      const resumed = elapsed > .25 && !fresh
      const delta = Math.min(elapsed, fresh && elapsed > .25 ? 1 / 60 : .05)
      if (reduced || resumed) {
        spring.position = held ? 1 : 0; spring.velocity = 0; spring.token = token
      } else {
        if (spring.token !== token) {
          spring.token = token
          if (age < 120) spring.velocity = spring.position > .78 ? -7 : 30
        }
        const steps = Math.max(1, Math.ceil(delta * 120)), dt = delta / steps
        for (let step = 0; step < steps; step++) {
          spring.velocity += (900 * (target - spring.position) - 45 * spring.velocity) * dt
          spring.position = clamp(spring.position + spring.velocity * dt, -.04, 1.04)
        }
        if (Math.abs(spring.position - target) < .002 && Math.abs(spring.velocity) < .025) {
          spring.position = target; spring.velocity = 0
        }
      }
      const glow = reduced ? held ? .45 : 0 : Math.max(held ? .20 : 0, clamp(1 - age / 210))
      moving ||= !reduced && (Math.abs(spring.velocity) > .025 || Math.abs(spring.position - target) > .002 || age < 220)
      return { down: clamp(spring.position), glow }
    })
    this.frozen = { left: result[0], right: result[1], moving }
    return this.frozen
  }
}
