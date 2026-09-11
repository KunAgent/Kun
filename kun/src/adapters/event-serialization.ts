import type { RuntimeEvent } from '../contracts/events.js'

/**
 * Runtime events are immutable once allocated: the same object reference
 * flows through the durable append and then to every SSE subscriber, so a
 * WeakMap lets each hop reuse one serialization instead of re-stringifying
 * per sink. Entries disappear with the event itself.
 */
const serializedEvents = new WeakMap<RuntimeEvent, string>()

export function serializeRuntimeEvent(event: RuntimeEvent): string {
  const cached = serializedEvents.get(event)
  if (cached !== undefined) return cached
  const serialized = JSON.stringify(event)
  serializedEvents.set(event, serialized)
  return serialized
}
