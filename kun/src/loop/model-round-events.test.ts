import { describe, expect, it } from 'vitest'
import { buildRouteSwitchEvent } from './model-round-events.js'

const baseIntent = {
  kind: 'route_switching' as const,
  from: { providerId: 'provider-a', modelId: 'model-a' },
  to: { providerId: 'provider-b', modelId: 'model-b' }
}

describe('buildRouteSwitchEvent', () => {
  it('redacts provider secrets embedded in the rejection message before persisting', () => {
    const event = buildRouteSwitchEvent(
      { threadId: 'thread-1', turnId: 'turn-1' },
      {
        ...baseIntent,
        reason: 'request',
        message: 'upstream rejected key sk-abcdef1234567890 at https://user:pass@relay.example.com/v1'
      }
    )

    expect(event.failureSummary).toBeDefined()
    expect(event.failureSummary).not.toContain('sk-abcdef1234567890')
    expect(event.failureSummary).not.toContain('user:pass@')
    expect(event.reason).toBe('request')
  })

  it('omits failureSummary when the rejection has no message', () => {
    const event = buildRouteSwitchEvent(
      { threadId: 'thread-1', turnId: 'turn-1' },
      { ...baseIntent }
    )

    expect(event.failureSummary).toBeUndefined()
    expect(event).toMatchObject({
      kind: 'model_route_switch',
      fromProviderId: 'provider-a',
      toProviderId: 'provider-b'
    })
  })
})
