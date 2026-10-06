import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getYamlValue } from './edit/yaml.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

describe('Aider adapter', () => {
  it('sets the OpenAI-compatible options, weak model and effort, then restores', () => {
    const file = h.write('.aider.conf.yml', '# aider\ndark-mode: true\nmodel: sonnet\n')
    h.service.connect('aider', wiringTarget('coding', { smallModel: 'glm-4.6', effort: 'high' }))
    const text = h.read(file)
    expect(getYamlValue(text, ['openai-api-base'])).toBe(`${ORIGIN}/v1`)
    expect(getYamlValue(text, ['openai-api-key'])).toBe(KEY)
    expect(getYamlValue(text, ['model'])).toBe('openai/coding')
    expect(getYamlValue(text, ['weak-model'])).toBe('openai/glm-4.6')
    expect(getYamlValue(text, ['reasoning-effort'])).toBe('high')
    expect(h.service.status('aider', ORIGIN)).toMatchObject({ connected: true, drifted: false, model: 'coding' })
    h.service.disconnect('aider', ORIGIN)
    expect(h.read(file)).toBe('# aider\ndark-mode: true\nmodel: sonnet\n')
  })
  it('creates and removes its own file, and rejects max effort', () => {
    h.service.connect('aider', wiringTarget('coding'))
    const file = join(h.home, '.aider.conf.yml')
    expect(h.exists(file)).toBe(true)
    h.service.disconnect('aider', ORIGIN)
    expect(h.exists(file)).toBe(false)
    expect(() => h.service.connect('aider', wiringTarget('coding', { effort: 'max' }))).toThrow(/reasoning 'max'/)
  })
})
