import { describe, expect, it } from 'vitest'
import { DesktopInputArbiter } from './input-arbiter'
describe('DesktopInputArbiter', () => {
  it('never grants human input while AI input is executing, and keeps the reverse boundary', () => {
    const arbiter = new DesktopInputArbiter(), release = arbiter.beginAi()
    expect(() => arbiter.acquire('human')).toThrow('DESKTOP_BUSY')
    release(); release(); arbiter.acquire('human')
    expect(() => arbiter.beginAi()).toThrow('HUMAN_CONTROL_ACTIVE')
    arbiter.release('other'); expect(() => arbiter.acquire('other')).toThrow('DESKTOP_BUSY')
    arbiter.release('human'); expect(() => arbiter.beginAi()).not.toThrow()
  })
})
