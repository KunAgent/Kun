import { describe, expect, it } from 'vitest'
import {
  decideProviderRequest,
  initialProviderCircuit,
  recordProviderFailure,
  recordProviderSuccess
} from './provider-circuit-breaker.js'

describe('provider circuit breaker policy', () => {
  it('opens after retryable failures and allows one half-open probe', () => {
    const policy = { failureThreshold: 2, openDurationMs: 100 }
    let state = initialProviderCircuit()
    state = recordProviderFailure(state, 'server', 10, policy)
    state = recordProviderFailure(state, 'timeout', 20, policy)
    expect(decideProviderRequest(state, 50, policy).reason).toBe('open')
    const probe = decideProviderRequest(state, 121, policy)
    expect(probe).toMatchObject({ allowed: true, probe: true, reason: 'half-open-probe' })
    expect(probe.snapshot.probeInFlight).toBe(true)
    expect(decideProviderRequest(probe.snapshot, 122, policy).reason)
      .toBe('half-open-busy')
  })

  it('closes and resets on success', () => {
    const open = recordProviderFailure(
      recordProviderFailure(initialProviderCircuit(), 'rate-limit', 1, { failureThreshold: 2, openDurationMs: 10 }),
      'network',
      2,
      { failureThreshold: 2, openDurationMs: 10 }
    )
    expect(recordProviderSuccess(open)).toEqual(initialProviderCircuit())
  })

  it('does not trip or retry automatically for authentication and client failures', () => {
    const state = recordProviderFailure(
      recordProviderFailure(initialProviderCircuit(), 'authentication', 1),
      'client',
      2
    )
    expect(state).toEqual(initialProviderCircuit())
  })

  it('fails closed for invalid snapshots while keeping a safe default policy', () => {
    const decision = decideProviderRequest({ state: 'invalid' as never, consecutiveFailures: -1, openedAt: null, probeInFlight: false }, 0)
    expect(decision).toMatchObject({ allowed: true, reason: 'closed' })
    expect(recordProviderFailure(initialProviderCircuit(), 'server', 0, { failureThreshold: 0, openDurationMs: 0 }).consecutiveFailures)
      .toBe(1)
  })

  it('rejects unknown failure kinds and invalid timestamps without opening the circuit', () => {
    const state = recordProviderFailure(
      { ...initialProviderCircuit(), probeInFlight: true },
      'unknown' as never,
      Number.NaN
    )
    expect(state).toEqual(initialProviderCircuit())
    expect(decideProviderRequest(initialProviderCircuit(), Number.NaN).allowed).toBe(false)
  })

  it('does not preserve unknown fields from untrusted state or policy objects', () => {
    const decision = decideProviderRequest(
      { ...initialProviderCircuit(), injected: true } as never,
      0,
      { failureThreshold: 1, openDurationMs: 1, injected: true } as never
    )
    expect(decision.snapshot).toEqual(initialProviderCircuit())
  })
})
