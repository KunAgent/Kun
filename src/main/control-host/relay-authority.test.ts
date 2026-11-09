import { expect, it } from 'vitest'
import { RelayAuthority } from './relay-authority'
it('only accepts the original authenticated envelope once, and fences it on disconnect', () => {
  const gate = new RelayAuthority()
  gate.observe(JSON.stringify({ v: 1, kind: 'hello', payload: { leaseExpiresAt: Date.now() + 60000 } }))
  const frame = { v: 1 as const, kind: 'invoke' as const, id: 'request', src: 'phone', dst: 'host', payload: { example: 'original' } }
  gate.observe(JSON.stringify(frame))
  expect(gate.consume({ ...frame, payload: { example: 'changed' } })).toBe(false)
  expect(gate.consume(frame)).toBe(true)
  expect(gate.consume(frame)).toBe(false)
  gate.observe(JSON.stringify(frame)); gate.clear()
  expect(gate.consume(frame)).toBe(false)
})
