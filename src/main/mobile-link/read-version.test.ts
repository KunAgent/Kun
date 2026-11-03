import { describe, expect, it } from 'vitest'
import { conditionalCall, conditionalResult, readVersion } from './read-version'

describe('conditional reads', () => {
  it('strips the optional version before the runtime envelope sees the call', () => {
    const call = { method: 'code.list', requestId: 'r', expiresAt: 1, params: {} }
    expect(conditionalCall({ ...call, ifVersion: 'v' })).toEqual({ call, ifVersion: 'v' })
    expect(conditionalCall(call)).toEqual({ call })
  })
  it('answers an unchanged read with a marker and a changed one with its new version', () => {
    const value = { threads: [{ id: 't' }] }
    const first = conditionalResult('code.list', value, '') as any
    expect(first.threads).toEqual(value.threads)
    expect(first.readVersion).toBe(readVersion('code.list', value))
    expect(conditionalResult('code.list', value, first.readVersion)).toEqual({ readUnchanged: true, readVersion: first.readVersion })
    expect(conditionalResult('code.list', value, undefined)).toBe(value)
    expect(conditionalResult('code.turn.start', value, first.readVersion)).toBe(value)
  })
  it('ignores the catalog confirmation time but not real catalog changes', () => {
    const catalog = (at: number, models: string[]) => ({ host: { runtimeVersion: '1', confirmedAt: at }, models })
    expect(readVersion('catalog.get', catalog(1, ['a']))).toBe(readVersion('catalog.get', catalog(2, ['a'])))
    expect(readVersion('catalog.get', catalog(1, ['a']))).not.toBe(readVersion('catalog.get', catalog(1, ['b'])))
  })
})
