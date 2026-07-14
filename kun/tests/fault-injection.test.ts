import { describe, expect, it } from 'vitest'
import { normalizeFaultInjectionSpec, shouldInjectFault } from '../src/contracts/fault-injection.js'
import { FaultInjectionController, faultInjectionSpecForTests } from '../src/services/fault-injection-controller.js'

describe('fault injection contract', () => {
  it('defaults to disabled, one activation, and no delay', () => {
    expect(normalizeFaultInjectionSpec({ kind: 'http-timeout', enabled: false })).toEqual({
      ok: true,
      value: { kind: 'http-timeout', enabled: false, once: true, delayMs: 0 }
    })
  })

  it('allows a bounded delayed repeated fault for test harnesses', () => {
    const result = normalizeFaultInjectionSpec({
      kind: 'sse-disconnect',
      enabled: true,
      once: false,
      delayMs: 1_000
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(shouldInjectFault(result.value, 0)).toBe(true)
      expect(shouldInjectFault(result.value, 100)).toBe(true)
    }
  })

  it('only allows the first activation for one-shot faults', () => {
    const result = normalizeFaultInjectionSpec({ kind: 'disk-full', enabled: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(shouldInjectFault(result.value, 0)).toBe(true)
      expect(shouldInjectFault(result.value, 1)).toBe(false)
    }
  })

  it.each([
    [{ kind: 'unknown', enabled: true }, 'invalid-kind'],
    [{ kind: 'http-429', enabled: 'yes' }, 'invalid-enabled'],
    [{ kind: 'http-429', enabled: true, once: 'yes' }, 'invalid-once'],
    [{ kind: 'http-429', enabled: true, delayMs: 60_001 }, 'invalid-delay'],
    [{ kind: 'http-429', enabled: true, debug: true }, 'unknown-field']
  ])('rejects malformed specs %#', (input, error) => {
    expect(normalizeFaultInjectionSpec(input)).toEqual({ ok: false, error })
  })

  it('fails closed for invalid activation counts or disabled specs', () => {
    const result = normalizeFaultInjectionSpec({ kind: 'sqlite-busy', enabled: false })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(shouldInjectFault(result.value, 0)).toBe(false)
      expect(shouldInjectFault({ ...result.value, enabled: true }, -1)).toBe(false)
      expect(shouldInjectFault({ ...result.value, enabled: true }, Number.NaN)).toBe(false)
      expect(shouldInjectFault({ kind: 'unknown', enabled: true, once: false, delayMs: 0 }, 0)).toBe(false)
    }
  })

  it('activates a configured fault once and resets after reconfiguration', async () => {
    const controller = new FaultInjectionController()
    controller.configure(faultInjectionSpecForTests('http-429'))
    await expect(controller.activate('http-429')).resolves.toMatchObject({ kind: 'http-429', activation: 0 })
    await expect(controller.activate('http-429')).resolves.toBeNull()
    await expect(controller.activate('http-timeout')).resolves.toBeNull()
    controller.configure(faultInjectionSpecForTests('http-429'))
    await expect(controller.activate('http-429')).resolves.toMatchObject({ activation: 0 })
  })

  it('honours bounded delay and aborts before activation completes', async () => {
    const controller = new FaultInjectionController()
    controller.configure(faultInjectionSpecForTests('http-timeout', { delayMs: 20 }))
    const started = Date.now()
    await controller.activate('http-timeout')
    expect(Date.now() - started).toBeGreaterThanOrEqual(10)

    controller.configure(faultInjectionSpecForTests('http-timeout', { delayMs: 60_000 }))
    const abort = new AbortController()
    const pending = controller.activate('http-timeout', abort.signal)
    abort.abort()
    await expect(pending).rejects.toThrow('aborted')
  })
})
