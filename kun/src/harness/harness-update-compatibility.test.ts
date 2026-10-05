import { expect, it } from 'vitest'
import { harnessUpdateCompatible } from './harness-update-compatibility.js'
import type { HarnessTestResponse } from '../contracts/harness-test.js'
it('allows updating signed-out software without claiming that the Agent is usable', () => {
  const result = { ok: false, detect: { ok: true }, handshake: { ok: true }, readiness: { usable: false,
    checks: [{ id: 'installation', ok: true }, { id: 'configuration', ok: true }, { id: 'credentials', ok: false }, { id: 'protocol', ok: true }] } } as HarnessTestResponse
  expect(harnessUpdateCompatible(result)).toBe(true)
  expect(result.readiness!.usable).toBe(false)
  expect(harnessUpdateCompatible({ ...result, handshake: { ...result.handshake!, ok: false } })).toBe(false)
  expect(harnessUpdateCompatible({ ...result, readiness: { ...result.readiness!, detail: 'Configuration changed during verification' } })).toBe(false)
  expect(harnessUpdateCompatible({ ...result, readiness: { ...result.readiness!, checks: [{ id: 'configuration', ok: false }] } })).toBe(false)
})
