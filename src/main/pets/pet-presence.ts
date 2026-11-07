import { emptyPetPresence, PET_PRESENCE_TTL_MS, type PetPresenceSignal, type PetPresenceSnapshot, type PetReactionKind } from '../../shared/pets-interactions'

const PRIORITY: Record<PetReactionKind, number> = { typing: 1, transcribing: 2, listening: 3, speaking: 4 }
type Input = NonNullable<PetPresenceSnapshot['input']> & { updatedAt: number; local: boolean }

/** Ephemeral activity never enters the pet settings, thread log, or model context. */
export class PetPresence {
  private value = emptyPetPresence()
  private readonly inputs = new Map<string, Input>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly publish: (snapshot: PetPresenceSnapshot) => void, private readonly now = Date.now) {}

  snapshot(): PetPresenceSnapshot { return structuredClone(this.value) }

  update(senderId: number, signal: PetPresenceSignal): void {
    const now = this.now()
    if (signal.type === 'model') {
      if (this.value.model?.model === signal.model && this.value.model.provider === signal.provider) return
      this.value.modelChangedAt = signal.announce ? now : 0
      this.value.model = { model: signal.model, provider: signal.provider }
    } else {
      const key = `${senderId}:${signal.source}`
      if (signal.kind === 'idle') this.inputs.delete(key)
      else {
        if (!this.inputs.has(key) && this.inputs.size >= 32) this.inputs.delete(this.inputs.keys().next().value!)
        this.inputs.set(key, { kind: signal.kind, level: Math.round(signal.level * 10) / 10,
          local: senderId >= 0, updatedAt: now, expiresAt: now + PET_PRESENCE_TTL_MS })
      }
    }
    this.flush()
  }

  clear(): void {
    this.inputs.clear()
    this.value = { ...emptyPetPresence(), revision: this.value.revision }
    this.flush()
  }

  dispose(): void { clearTimeout(this.timer); this.inputs.clear() }

  private flush(): void {
    clearTimeout(this.timer)
    const now = this.now()
    for (const [key, input] of this.inputs) if (input.expiresAt <= now) this.inputs.delete(key)
    const current = [...this.inputs.values()].sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || Number(b.local) - Number(a.local) || b.updatedAt - a.updatedAt)[0]
    this.value.input = current ? { kind: current.kind, level: current.level, expiresAt: current.expiresAt } : null
    this.value.revision++
    this.publish(this.snapshot())
    if (this.inputs.size) {
      this.timer = setTimeout(() => this.flush(), Math.max(1, Math.min(...[...this.inputs.values()].map((input) => input.expiresAt)) - now))
      this.timer.unref?.()
    }
  }
}
