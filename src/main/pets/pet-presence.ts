import { updatePetTyping } from '../../shared/pets-typing'
import { emptyPetPresence, PET_PRESENCE_TTL_MS, type PetPresenceSignal, type PetPresenceSnapshot, type PetReactionKind } from '../../shared/pets-interactions'

const PRIORITY: Record<PetReactionKind, number> = { typing: 1, transcribing: 2, listening: 3, speaking: 4 }
type Input = NonNullable<PetPresenceSnapshot['input']> & { updatedAt: number; local: boolean }

/** Ephemeral activity never enters the pet settings, thread log, or model context. */
export class PetPresence {
  private value = emptyPetPresence()
  private globalKeyboardActive = false
  private readonly inputs = new Map<string, Input>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly publish: (snapshot: PetPresenceSnapshot) => void, private readonly now = Date.now) {}

  snapshot(): PetPresenceSnapshot { return structuredClone(this.value) }

  update(senderId: number, signal: PetPresenceSignal): void {
    const now = this.now()
    if (senderId >= 0 && this.globalKeyboardActive && (signal.type === 'keyboard' || (signal.type === 'input' && signal.kind === 'typing'))) return
    if (signal.type === 'model') {
      if (this.value.model?.model === signal.model && this.value.model.provider === signal.provider) return
      this.value.modelChangedAt = signal.announce ? now : 0
      this.value.model = { model: signal.model, provider: signal.provider }
    } else {
      const key = `${senderId}:${signal.source}`
      const kind = signal.type === 'keyboard' ? 'typing' : signal.kind
      if (kind === 'idle') this.inputs.delete(key)
      else {
        if (!this.inputs.has(key) && this.inputs.size >= 32) this.inputs.delete(this.inputs.keys().next().value!)
        const previous = this.inputs.get(key)
        const typing = signal.type === 'keyboard'
          ? updatePetTyping(previous?.typing, signal.held, signal.tap, now)
          : signal.kind === 'typing' ? updatePetTyping(previous?.typing, 0,
            (previous?.typing?.left.sequence ?? 0) > (previous?.typing?.right.sequence ?? 0) ? 2 : 1, now) : undefined
        this.inputs.set(key, { kind,
          level: signal.type === 'keyboard' ? .5 : Math.round(signal.level * 10) / 10,
          local: senderId >= 0, updatedAt: now, expiresAt: now + PET_PRESENCE_TTL_MS,
          ...(typing ? { typing } : {}) })
      }
    }
    this.flush()
  }

  /** One authoritative keyboard source avoids counting an in-app key twice. */
  setGlobalKeyboardActive(active: boolean): void {
    if (this.globalKeyboardActive === active) return
    this.globalKeyboardActive = active
    if (active) for (const [key, input] of this.inputs) if (input.local && input.kind === 'typing') this.inputs.delete(key)
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
    this.value.input = current ? { kind: current.kind, level: current.level, expiresAt: current.expiresAt, ...(current.typing ? { typing: current.typing } : {}) } : null
    this.value.revision++
    this.publish(this.snapshot())
    if (this.inputs.size) {
      this.timer = setTimeout(() => this.flush(), Math.max(1, Math.min(...[...this.inputs.values()].map((input) => input.expiresAt)) - now))
      this.timer.unref?.()
    }
  }
}
