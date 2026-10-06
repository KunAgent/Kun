import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { getJsoncValue } from './edit/jsonc.js'
import { ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

describe('Pi adapter', () => {
  it('honors PI_CODING_AGENT_DIR and spreads across models.json and settings.json', () => {
    const dir = join(h.home, 'pi-agent')
    const custom = wiringHarness({ PI_CODING_AGENT_DIR: dir })
    custom.service.connect('pi', wiringTarget('coding', { effort: 'max' }))
    const models = custom.read(join(dir, 'models.json'))
    const settings = custom.read(join(dir, 'settings.json'))
    expect(getJsoncValue(models, ['providers', 'kun', 'api'])).toBe('openai-completions')
    expect(getJsoncValue(models, ['providers', 'kun', 'models'])).toEqual([
      { id: 'coding', name: 'Daily coding', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 32_000 },
      { id: 'glm-4.6', name: 'glm-4.6', input: ['text'], contextWindow: 128_000 }])
    expect(getJsoncValue(settings, ['defaultThinkingLevel'])).toBe('xhigh')
    custom.service.disconnect('pi', ORIGIN)
    expect(custom.exists(join(dir, 'models.json'))).toBe(false)
    expect(custom.exists(join(dir, 'settings.json'))).toBe(false)
    custom.dispose()
  })
  it('restores the user settings file byte for byte', () => {
    const settings = h.write('.pi/agent/settings.json', '{\n  "defaultProvider": "anthropic",\n  "theme": "dark"\n}\n')
    h.service.connect('pi', wiringTarget('coding'))
    expect(getJsoncValue(h.read(settings), ['defaultProvider'])).toBe('kun')
    h.service.disconnect('pi', ORIGIN)
    expect(h.read(settings)).toBe('{\n  "defaultProvider": "anthropic",\n  "theme": "dark"\n}\n')
  })
})
