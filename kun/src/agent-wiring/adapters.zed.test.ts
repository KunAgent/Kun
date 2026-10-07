import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getJsoncValue } from './edit/jsonc.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

describe('Zed adapter', () => {
  const ORIGINAL = '{\n  // my theme\n  "theme": "One Dark",\n  "agent": { "always_allow_tool_actions": false }\n}\n'
  it('adds Kun as an OpenAI-compatible provider and the default model, without the key', () => {
    const file = h.write('.config/zed/settings.json', ORIGINAL)
    const status = h.service.connect('zed', wiringTarget('coding'))
    expect(status).toMatchObject({ connected: true, drifted: false, model: 'coding', keyDelivery: 'clipboard', notice: 'manual-key', pickInAgent: true })
    const text = h.read(file)
    expect(text).toContain('// my theme')
    expect(getJsoncValue(text, ['language_models', 'openai_compatible', 'Kun'])).toEqual({ api_url: `${ORIGIN}/v1`, available_models: [
      { name: 'coding', display_name: 'Daily coding', max_tokens: 200_000, max_output_tokens: 32_000,
        capabilities: { tools: true, images: true, parallel_tool_calls: false, prompt_cache_key: false } },
      { name: 'glm-4.6', display_name: 'glm-4.6', max_tokens: 128_000,
        capabilities: { tools: true, images: false, parallel_tool_calls: false, prompt_cache_key: false } }] })
    expect(getJsoncValue(text, ['agent', 'default_model'])).toEqual({ provider: 'Kun', model: 'coding' })
    expect(getJsoncValue(text, ['agent', 'always_allow_tool_actions'])).toBe(false)
    // Zed keeps keys in its keychain; nothing secret goes into settings.json.
    expect(text).not.toContain(KEY)
    h.service.disconnect('zed', ORIGIN)
    expect(h.read(file)).toBe(ORIGINAL)
  })
  it('connects without a key and follows APPDATA on Windows', () => {
    const win = wiringHarness({ APPDATA: join(h.home, 'Roaming') }, 'win32')
    win.service.connect('zed', wiringTarget('coding', { key: '' }))
    expect(getJsoncValue(win.read(join(h.home, 'Roaming', 'Zed', 'settings.json')), ['agent', 'default_model', 'model'])).toBe('coding')
    win.dispose()
  })
  it('notices when the user points Zed at another provider', () => {
    const file = h.write('.config/zed/settings.json', ORIGINAL)
    h.service.connect('zed', wiringTarget('coding'))
    h.write('.config/zed/settings.json', h.read(file).replace(`${ORIGIN}/v1`, 'https://elsewhere.example/v1'))
    expect(h.service.status('zed', ORIGIN)).toMatchObject({ connected: true, drifted: true })
  })
})
