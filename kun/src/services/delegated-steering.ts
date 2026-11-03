import type { SteeringEntry } from '../contracts/turns.js'
import { makeUserItem } from '../domain/item.js'
import { flushDurableSteering } from './durable-steering.js'
import type { TurnService } from './turn-service-core.js'

/**
 * Mid-turn guidance for a delegated runtime whose engine accepts user input
 * while it is still working. The agent loop seals steering before handing a
 * delegated turn over; `open` reopens admission so the composer's "guide"
 * reaches the running Agent, and the runtime must seal it again (draining
 * whatever won the race) before the turn settles.
 */
export type DelegatedSteering = {
  /** Fires after guidance may have become pending. */
  subscribe(listener: () => void): () => void
  /** Persist pending guidance as user items of the turn and return it. */
  take(): Promise<SteeringEntry[]>
  /** Close admission when nothing is pending; false means `take` again. */
  sealIfEmpty(): boolean
}

export function openDelegatedSteering(service: TurnService, threadId: string, turnId: string): DelegatedSteering {
  const steering = service['deps'].steering
  steering.reopen(turnId)
  return {
    subscribe: (listener) => steering.subscribe(turnId, listener),
    async take() {
      await steering.waitForAdmissions(turnId)
      const durable = await flushDurableSteering(service, threadId, turnId)
      const volatile = steering.drain(turnId)
      for (const entry of volatile) {
        await service.applyItem(threadId, makeUserItem({
          id: service['deps'].ids.next('item_steered'),
          turnId,
          threadId,
          text: entry.text,
          ...(entry.displayText ? { displayText: entry.displayText } : {}),
          ...(entry.messageSource ? { messageSource: entry.messageSource } : {}),
          ...(entry.attachmentIds?.length ? { attachmentIds: entry.attachmentIds } : {})
        }))
      }
      return [...durable, ...volatile]
    },
    sealIfEmpty: () => steering.sealIfEmpty(turnId)
  }
}
