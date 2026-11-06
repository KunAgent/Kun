import type { PetSummary } from '@shared/pets'
import { PET_SCENE_IDS, type PetSceneId } from '@shared/pets-ensemble'
import { PET_VISIT_ARRIVAL_MS, PET_VISIT_COOLDOWN_MS, PET_VISIT_DEPARTURE_MS, PET_VISIT_REQUEST_TTL_MS,
  type PetVisit, type PetVisitPreferences, type PetVisitReason, type PetVisitRequest } from '@shared/pets-visits'

export type PetVisitContext = {
  primaryId: string | null
  pets: PetSummary[]
  preferences: PetVisitPreferences
  visible: boolean
  reduced: boolean
  blocked: boolean
  working: boolean
  inputActive: boolean
  modelPetId: string | null
  modelChangedAt: number
  completedKeys: string[]
}

const INTERVALS = { quiet: [8 * 60_000, 14 * 60_000], balanced: [4 * 60_000, 7 * 60_000], lively: [2 * 60_000, 4 * 60_000] } as const
const BUDGETS = { quiet: 2, balanced: 3, lively: 5 }
const CASUAL: PetSceneId[] = ['high-five', 'gift', 'chase', 'bubbles', 'circle-dance', 'tea', 'wave-relay', 'exercise', 'conga']
type Pending = { reason: PetVisitReason; at: number; expiresAt: number; preferred?: string; scene?: PetSceneId }

/** One finite visit at a time. No persisted parties or catch-up queue. */
export class PetVisitDirector {
  private current: PetVisit | null = null
  private primaryId: string | null = null
  private initialized = false
  private lastTick = 0
  private nextRandomAt = 0
  private cooldownUntil = 0
  private quietUntil = 0
  private inputSince: number | null = null
  private lastModelAt = 0
  private preferenceKey = ''
  private pending: Pending | null = null
  private completed = new Set<string>()
  private requests = new Set<string>()
  private recentGuests: string[] = []
  private recentScenes: PetSceneId[] = []
  private automaticStarts: number[] = []
  private sequence = 0

  constructor(private readonly random = Math.random) {}

  update(context: PetVisitContext, now: number): PetVisit | null {
    const resumed = this.initialized && (now - this.lastTick > 30_000 || now < this.lastTick)
    this.lastTick = now
    if (!this.initialized || this.primaryId !== context.primaryId || !context.visible || resumed) {
      this.initialized = true
      this.primaryId = context.primaryId
      this.current = null
      this.pending = null
      this.lastModelAt = context.modelChangedAt
      this.completed = new Set(context.completedKeys)
      this.inputSince = null
      this.nextRandomAt = now + this.interval(context)
      this.preferenceKey = `${context.preferences.enabled}:${context.preferences.frequency}`
      return null
    }
    const preferenceKey = `${context.preferences.enabled}:${context.preferences.frequency}`
    if (preferenceKey !== this.preferenceKey) {
      this.preferenceKey = preferenceKey
      this.pending = null
      this.nextRandomAt = now + this.interval(context)
    }
    if (this.current && now >= this.current.endsAt) this.current = null
    const blocked = context.blocked || context.working || context.inputActive || now < this.quietUntil
    if (context.inputActive) {
      this.inputSince ??= now
      this.quietUntil = now + 2500
    } else if (this.inputSince !== null) {
      if (now - this.inputSince >= 90_000 && this.random() < .25) {
        this.pending = { reason: 'break', scene: 'exercise', at: now + 4000, expiresAt: now + 10_000 }
      }
      this.inputSince = null
    }
    const guests = this.guests(context)
    if (this.current) {
      const unavailable = this.current.guestIds.some((id) => !guests.some((pet) => pet.id === id))
      if (unavailable || (this.current.reason !== 'manual' &&
        (!context.preferences.enabled || context.reduced || context.blocked || context.working || context.inputActive))) this.leave(now)
    }
    if (context.modelChangedAt !== this.lastModelAt) {
      this.lastModelAt = context.modelChangedAt
      if (this.current?.reason === 'model') this.leave(now)
      if (context.modelPetId && now - context.modelChangedAt < 8000 && context.modelChangedAt > 0 &&
        !blocked && this.eligible(context, now) && this.random() < .7) {
        this.pending = { reason: 'model', preferred: context.modelPetId, at: now + 900, expiresAt: now + 5000 }
      } else this.pending = null
    }
    const newCompletion = context.completedKeys.some((key) => !this.completed.has(key))
    for (const key of context.completedKeys) this.completed.add(key)
    while (this.completed.size > 128) this.completed.delete(this.completed.values().next().value!)
    if (newCompletion && !blocked && !this.pending && this.eligible(context, now) && this.random() < .55) {
      this.pending = { reason: 'celebration', scene: this.pick<PetSceneId>(['cheer', 'high-five', 'dance']), at: now + 2500, expiresAt: now + 8000 }
    }
    // Discard situational invitations when the user returns to work.
    if (this.pending && (now >= this.pending.expiresAt || context.inputActive || context.blocked || context.working)) this.pending = null
    if (this.pending && now >= this.pending.at && !blocked && this.eligible(context, now)) {
      const pending = this.pending
      this.pending = null
      this.begin(context, pending.reason, now, pending.scene, pending.preferred)
    }
    if (now >= this.nextRandomAt) {
      if (!blocked && this.eligible(context, now)) this.begin(context, 'random', now)
      this.nextRandomAt = now + (blocked ? this.between(45_000, 90_000) : this.interval(context))
    }
    return this.current
  }

  request(request: PetVisitRequest, context: PetVisitContext, now: number): PetVisit | null {
    if (!this.initialized || this.primaryId !== context.primaryId || now < this.lastTick) this.update(context, now)
    if (request.primaryId && request.primaryId !== context.primaryId) return this.current
    if (this.requests.has(request.id)) return this.current
    this.requests.add(request.id)
    while (this.requests.size > 64) this.requests.delete(this.requests.values().next().value!)
    if (request.kind === 'dismiss') {
      this.pending = null
      this.leave(now)
      this.cooldownUntil = now + PET_VISIT_COOLDOWN_MS
      this.nextRandomAt = now + this.interval(context)
      return this.current
    }
    if (now - request.createdAt > PET_VISIT_REQUEST_TTL_MS || request.createdAt > now + 1000 || !context.visible || !context.primaryId) return this.current
    this.begin(context, 'manual', now, request.scene)
    return this.current
  }

  private eligible(context: PetVisitContext, now: number): boolean {
    this.automaticStarts = this.automaticStarts.filter((time) => time > now - 10 * 60_000)
    return Boolean(context.primaryId && context.preferences.enabled && !context.reduced && !this.current &&
      now >= this.cooldownUntil && this.automaticStarts.length < BUDGETS[context.preferences.frequency])
  }

  private begin(context: PetVisitContext, reason: PetVisitReason, now: number, requestedScene?: PetSceneId, preferred?: string): void {
    const candidates = this.guests(context)
    if (!candidates.length || !context.primaryId) return
    const matching = preferred ? candidates.find((pet) => pet.id === preferred) : undefined
    if (preferred && !matching) return
    const recent = new Set(this.recentGuests.slice(-3))
    const fresh = candidates.filter((pet) => !recent.has(pet.id))
    const first = matching ?? this.pick(fresh.length ? fresh : candidates)
    const guests = [first]
    const sizeRoll = this.random()
    const count = reason === 'model' ? 1 : Math.min(candidates.length, sizeRoll < .65 ? 1 : sizeRoll < .9 ? 2 : 3)
    for (let i = 1; i < count; i++) {
      const remaining = candidates.filter((pet) => !guests.includes(pet))
      const unused = remaining.filter((pet) => !recent.has(pet.id))
      guests.push(this.pick(unused.length ? unused : remaining))
    }
    const themes = first.interactions?.visits?.scenes ?? CASUAL
    const availableScenes = themes.filter((scene) => !this.recentScenes.slice(-2).includes(scene))
    const scene = requestedScene ?? this.pick(availableScenes.length ? availableScenes : themes)
    if (!(PET_SCENE_IDS as readonly string[]).includes(scene)) return
    const playMs = reason === 'model' ? this.between(3500, 5000) : this.between(6500, 10_000)
    this.current = { id: ++this.sequence, primaryId: context.primaryId, guestIds: guests.map((pet) => pet.id), reason, scene,
      startedAt: now, playUntil: now + PET_VISIT_ARRIVAL_MS + playMs,
      plannedPlayUntil: now + PET_VISIT_ARRIVAL_MS + playMs,
      endsAt: now + PET_VISIT_ARRIVAL_MS + playMs + PET_VISIT_DEPARTURE_MS, seed: this.random() }
    this.pending = null
    this.recentGuests = [...this.recentGuests, ...this.current.guestIds].slice(-8)
    this.recentScenes = [...this.recentScenes, scene].slice(-3)
    this.cooldownUntil = this.current.endsAt + PET_VISIT_COOLDOWN_MS
    this.nextRandomAt = this.current.endsAt + this.interval(context)
    if (reason !== 'manual') this.automaticStarts.push(now)
  }

  private leave(now: number): void {
    if (!this.current || this.current.playUntil <= now) return
    this.current = { ...this.current, playUntil: now, endsAt: now + 800 }
  }

  private guests(context: PetVisitContext): PetSummary[] {
    return context.pets.filter((pet) => pet.source === 'kun-builtin' && pet.available && pet.spritesheetUrl &&
      pet.id !== context.primaryId)
  }

  private interval(context: PetVisitContext): number {
    const [min, max] = INTERVALS[context.preferences.frequency]
    return this.between(min, max)
  }
  private between(min: number, max: number): number { return min + this.random() * (max - min) }
  private pick<T>(items: readonly T[]): T { return items[Math.min(items.length - 1, Math.floor(this.random() * items.length))] }
}
