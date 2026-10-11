import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentAdapter } from './adapters.js'
import { getJsoncValue } from './edit/jsonc.js'
import { getYamlValue } from './edit/yaml.js'
import { createWiringContext } from './service.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

const CONFIG = '# goose\nGOOSE_PROVIDER: anthropic\nGOOSE_MODEL: claude-sonnet-4-5\nextensions:\n  developer:\n    enabled: true\n'

describe('Goose adapter', () => {
  it('uses APPDATA on Windows', () => {
    const ctx = createWiringContext({ home: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, platform: 'win32', which: () => undefined })
    expect(agentAdapter('goose')!.files(ctx).config).toBe(join('C:\\Users\\me\\AppData\\Roaming', 'Block', 'goose', 'config', 'config.yaml'))
  })
  it('selects a Kun custom provider and restores both files exactly', () => {
    const config = h.write('.config/goose/config.yaml', CONFIG)
    h.service.connect('goose', wiringTarget('coding'))
    expect(getYamlValue(h.read(config), ['GOOSE_PROVIDER'])).toBe('kun')
    expect(getYamlValue(h.read(config), ['GOOSE_MODEL'])).toBe('coding')
    expect(h.read(config)).toContain('# goose')
    const provider = join(h.home, '.config/goose/custom_providers/kun.json')
    const text = h.read(provider)
    expect(getJsoncValue(text, ['engine'])).toBe('openai')
    expect(getJsoncValue(text, ['base_url'])).toBe(`${ORIGIN}/v1`)
    expect(getJsoncValue(text, ['headers', 'Authorization'])).toBe(`Bearer ${KEY}`)
    expect(getJsoncValue(text, ['dynamic_models'])).toBe(false)
    expect(getJsoncValue(text, ['models'])).toEqual([{ name: 'coding', context_limit: 200_000, reasoning: true },
      { name: 'glm-4.6', context_limit: 128_000, reasoning: false }])
    expect(h.service.status('goose', ORIGIN)).toMatchObject({ connected: true, drifted: false, model: 'coding' })
    h.service.disconnect('goose', ORIGIN)
    expect(h.read(config)).toBe(CONFIG)
    expect(h.exists(provider)).toBe(false)
  })
  it('keeps the user edit when restoring key by key', () => {
    const config = h.write('.config/goose/config.yaml', CONFIG)
    h.service.connect('goose', wiringTarget('coding'))
    h.write('.config/goose/config.yaml', h.read(config).replace('enabled: true', 'enabled: false'))
    h.service.disconnect('goose', ORIGIN)
    const text = h.read(config)
    expect(getYamlValue(text, ['GOOSE_PROVIDER'])).toBe('anthropic')
    expect(getYamlValue(text, ['GOOSE_MODEL'])).toBe('claude-sonnet-4-5')
    expect(getYamlValue(text, ['extensions', 'developer', 'enabled'])).toBe(false)
  })
})
