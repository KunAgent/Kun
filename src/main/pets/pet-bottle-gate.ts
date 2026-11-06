import { parsePetBottleDrop } from '../../shared/pets-bottle'

/** Duplicate SSE deliveries and renderer reloads cannot animate the same bottle twice. */
export class PetBottleGate {
  private readonly seen = new Set<string>()

  accept(input: unknown, now = Date.now()): { count: number; occurredAt: number } | null {
    const value = parsePetBottleDrop(input, now)
    if (!value) return null
    const fresh = value.dropIds.filter((id) => !this.seen.has(id))
    for (const id of fresh) this.seen.add(id)
    while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!)
    return fresh.length ? { count: fresh.length, occurredAt: value.occurredAt } : null
  }
}
