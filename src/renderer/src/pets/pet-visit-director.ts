import { isBuiltinPetId } from '@shared/pets-builtin'
import { jointSceneFor } from '@shared/pets-joint'
import { PET_SCENES, PET_SCENE_DIRECTORS } from './pet-ensemble-catalog'
import type { PetSummary } from '@shared/pets'
import { defaultPetBottleRecipe, PET_BOTTLE_BATCH_LIMIT, PET_BOTTLE_TTL_MS, type PetBottleRecipe } from '@shared/pets-bottle'
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
  eventsEnabled?: boolean
  bottleRecipe?: PetBottleRecipe
}

const INTERVALS = { quiet: [8 * 60_000, 14 * 60_000], balanced: [4 * 60_000, 7 * 60_000], lively: [2 * 60_000, 4 * 60_000] } as const
const BUDGETS = { quiet: 2, balanced: 3, lively: 5 }
const CASUAL: PetSceneId[] = ['bubbles', 'dance', 'cheer', 'beatbox']
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
  private pendingBottle: { count: number; expiresAt: number } | null = null
  private bottleCooldownUntil = 0

  constructor(private readonly random = Math.random) {}

  update(context: PetVisitContext, now: number): PetVisit | null {
    const resumed = this.initialized && (now - this.lastTick > 30_000 || now < this.lastTick)
    this.lastTick = now
    if (!this.initialized || this.primaryId !== context.primaryId || !context.visible || resumed) {
      this.initialized = true
      this.primaryId = context.primaryId
      this.current = null
      this.pending = null
      this.pendingBottle = null
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
        this.pending = { reason: 'break', scene: 'dance', at: now + 4000, expiresAt: now + 10_000 }
      }
      this.inputSince = null
    }
    const guests = this.guests(context)
    if (this.current) {
      const unavailable = this.current.guestIds.some((id) => !guests.some((pet) => pet.id === id))
      if (this.current.reason === 'bottle') {
        if (context.eventsEnabled === false || context.blocked || context.working || context.inputActive) this.leave(now)
      } else if (unavailable || (this.current.reason !== 'manual' &&
        (!context.preferences.enabled || context.reduced || context.blocked || context.working || context.inputActive))) this.leave(now)
    }
    if (this.pendingBottle && (now >= this.pendingBottle.expiresAt || context.eventsEnabled === false)) this.pendingBottle = null
    if (this.pendingBottle && !blocked && !this.current && now >= this.bottleCooldownUntil) this.beginBottle(context, now)
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
      this.pending = { reason: 'celebration', scene: this.pick<PetSceneId>(['cheer', 'dance']), at: now + 2500, expiresAt: now + 8000 }
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
    if (request.kind === 'clear-bottle') {
      this.pendingBottle = null
      if (this.current?.reason === 'bottle') this.current = null
      return this.current
    }
    if (request.kind === 'dismiss') {
      this.pending = null
      this.pendingBottle = null
      this.leave(now)
      this.cooldownUntil = now + PET_VISIT_COOLDOWN_MS
      this.nextRandomAt = now + this.interval(context)
      return this.current
    }
    if (now - request.createdAt > PET_VISIT_REQUEST_TTL_MS || request.createdAt > now + 1000 || !context.visible || !context.primaryId) return this.current
    if (request.kind === 'bottle') {
      const count = request.bottleCount
      if (context.eventsEnabled === false || !Number.isInteger(count) || !count || count < 1 || count > PET_BOTTLE_BATCH_LIMIT) return this.current
      this.pending = null
      if (this.current?.reason === 'bottle') {
        this.current = { ...this.current, bottleCount: Math.min(PET_BOTTLE_BATCH_LIMIT, (this.current.bottleCount ?? 1) + count) }
        return this.current
      }
      this.pendingBottle = { count: Math.min(PET_BOTTLE_BATCH_LIMIT, count + (this.pendingBottle?.count ?? 0)),
        expiresAt: Math.min(this.pendingBottle?.expiresAt ?? Infinity, request.createdAt + PET_BOTTLE_TTL_MS) }
      if (this.current && this.current.reason !== 'manual') this.leave(now)
      if (!this.current && !context.blocked && !context.inputActive && !context.working && now >= this.quietUntil && now >= this.bottleCooldownUntil) {
        this.beginBottle(context, now)
      }
      return this.current
    }
    this.pendingBottle = null
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
    if (requestedScene) requestedScene = jointSceneFor(requestedScene)
    if (!candidates.length || !context.primaryId) return
    const matching = preferred ? candidates.find((pet) => pet.id === preferred) : undefined
    if (preferred && !matching) return
    const recent = new Set(this.recentGuests.slice(-3))
    const fresh = candidates.filter((pet) => !recent.has(pet.id))
    const director = requestedScene ? candidates.find((pet) => pet.sourceId === PET_SCENE_DIRECTORS[requestedScene]) : undefined
    const first = matching ?? director ?? this.pick(fresh.length ? fresh : candidates)
    const guests = [first]
    const sizeRoll = this.random()
    const count = Math.min(candidates.length, reason === 'model' || sizeRoll < .65 ? 1 : 2)
    for (let i = 1; i < count; i++) {
      const remaining = candidates.filter((pet) => !guests.includes(pet))
      const unused = remaining.filter((pet) => !recent.has(pet.id))
      guests.push(this.pick(unused.length ? unused : remaining))
    }
    const residentThemes = context.pets.find((pet) => pet.id === context.primaryId)?.interactions?.visits?.scenes
    const themes = reason !== 'model' && residentThemes && this.random() < .35
      ? residentThemes : first.interactions?.visits?.scenes ?? CASUAL
    const jointThemes = [...new Set(themes.map(jointSceneFor))]
    const availableScenes = jointThemes.filter((scene) => !this.recentScenes.slice(-2).includes(scene))
    const scene = requestedScene ?? (reason === 'model' ? jointThemes[0] : this.pick(availableScenes.length ? availableScenes : jointThemes))
    if (!(PET_SCENE_IDS as readonly string[]).includes(scene)) return
    // Let the complete action and response play; compressed stories looked rushed.
    const playMs = PET_SCENES[scene].duration
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

  private beginBottle(context: PetVisitContext, now: number): void {
    if (!this.pendingBottle || !context.primaryId) return
    const duration = context.reduced ? 3000 : (context.bottleRecipe ?? defaultPetBottleRecipe()).durationMs
    this.current = { id: ++this.sequence, primaryId: context.primaryId, guestIds: [], reason: 'bottle', scene: 'gift',
      bottleCount: this.pendingBottle.count, startedAt: now, playUntil: now + duration - 900,
      plannedPlayUntil: now + duration - 900, endsAt: now + duration, seed: this.random() }
    this.pendingBottle = null
    this.pending = null
    this.bottleCooldownUntil = this.current.endsAt + 20_000
    this.cooldownUntil = Math.max(this.cooldownUntil, this.current.endsAt + PET_VISIT_COOLDOWN_MS)
    this.nextRandomAt = this.current.endsAt + this.interval(context)
  }

  private leave(now: number): void {
    if (!this.current || this.current.playUntil <= now) return
    this.current = { ...this.current, playUntil: now, endsAt: now + 800 }
  }

  private guests(context: PetVisitContext): PetSummary[] {
    return context.pets.filter((pet) => pet.source === 'kun-builtin' && isBuiltinPetId(pet.sourceId) && pet.available && pet.spritesheetUrl &&
      pet.id !== context.primaryId)
  }

  private interval(context: PetVisitContext): number {
    const [min, max] = INTERVALS[context.preferences.frequency]
    return this.between(min, max)
  }
  private between(min: number, max: number): number { return min + this.random() * (max - min) }
  private pick<T>(items: readonly T[]): T { return items[Math.min(items.length - 1, Math.floor(this.random() * items.length))] }
}
