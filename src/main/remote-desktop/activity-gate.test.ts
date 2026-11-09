import { expect, it } from 'vitest'
import { DesktopActivityGate } from './activity-gate'
it('excludes incoming phone and direct sessions while another computer is controlled', () => {
  const gate = new DesktopActivityGate()
  gate.claim('viewer', 'outgoing')
  expect(() => gate.claim('phone','incoming')).toThrow('DESKTOP_BUSY')
  gate.release('wrong-owner'); expect(gate.busy()).toBe(true)
  gate.release('viewer'); gate.claim('phone','incoming')
  expect(() => gate.claim('viewer','outgoing')).toThrow('DESKTOP_BUSY')
  gate.release('phone'); expect(gate.busy()).toBe(false)
})
