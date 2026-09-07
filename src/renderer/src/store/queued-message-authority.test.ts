import { describe, expect, it } from 'vitest'
import { reconcileQueuedMessages } from './queued-message-persistence'

describe('authoritative runtime queue reconciliation', () => {
  it('does not assign an unrelated running turn to an unconfirmed admission', () => {
    const row = { id: 'b', text: 'B', clientRequestId: 'b', deliveryState: 'starting' as const }
    expect(reconcileQueuedMessages([row], { busy: true, turnId: 'a' })).toEqual([row])
  })

  it('keeps a queued turn even when a stale active id and persisted user item claim it started', () => {
    const message = {
      id: 'q-b', text: 'wait for A', clientRequestId: 'request-b',
      deliveryState: 'in_flight' as const, deliveryTurnId: 'turn-b',
      deliveryUserMessageItemId: 'user-b'
    }
    expect(reconcileQueuedMessages([message], {
      busy: true, turnId: 'turn-b',
      blocks: [{ kind: 'user', id: 'user-b', turnId: 'turn-b', text: message.text }]
    }, [{ turnId: 'turn-b', clientRequestId: 'request-b' }])).toEqual([message])
  })
})
