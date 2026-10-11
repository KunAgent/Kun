import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getJsoncValue } from './edit/jsonc.js'
import { ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

describe('Crush adapter', () => {
  it('writes an openai provider with model facts and large/small selections', () => {
    h.service.connect('crush', wiringTarget('coding', { smallModel: 'glm-4.6', effort: 'high' }))
    const file = `${h.home}/.config/crush/crush.json`
    const text = h.read(file)
    expect(getJsoncValue(text, ['providers', 'kun', 'type'])).toBe('openai')
    expect(getJsoncValue(text, ['providers', 'kun', 'models'])).toEqual([
      { id: 'coding', name: 'Daily coding', context_window: 200_000, default_max_tokens: 32_000, can_reason: true, supports_attachments: true },
      { id: 'glm-4.6', name: 'glm-4.6', context_window: 128_000 }])
    expect(getJsoncValue(text, ['models', 'large'])).toEqual({ model: 'coding', provider: 'kun', reasoning_effort: 'high' })
    expect(getJsoncValue(text, ['models', 'small'])).toEqual({ model: 'glm-4.6', provider: 'kun', reasoning_effort: 'high' })
    h.service.disconnect('crush', ORIGIN)
    expect(h.exists(file)).toBe(false)
  })
  it('rejects efforts Crush cannot express', () => {
    expect(() => h.service.connect('crush', wiringTarget('coding', { effort: 'max' }))).toThrow(/reasoning 'max'/)
  })
})
