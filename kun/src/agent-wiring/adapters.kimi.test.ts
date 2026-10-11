import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTomlTable, getTomlTopLevel, listTomlTables } from './edit/toml.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

const CONFIG = `default_model = "kimi-for-coding"

[providers.moonshot]
type = "kimi"
base_url = "https://api.moonshot.cn/v1"
`

describe('Kimi Code adapter', () => {
  it('adds a provider, one table per model (dots in ids included) and the default model', () => {
    const file = h.write('.kimi-code/config.toml', CONFIG)
    h.service.connect('kimi', wiringTarget('glm-4.6'))
    const text = h.read(file)
    expect(getTomlTopLevel(text, 'default_model')).toBe('kun/glm-4.6')
    expect(getTomlTable(text, 'providers.kun')).toEqual({ type: 'kimi', base_url: `${ORIGIN}/v1`, api_key: KEY })
    expect(getTomlTable(text, 'models."kun/coding"')).toEqual({ provider: 'kun', model: 'coding', max_context_size: 200_000,
      capabilities: ['thinking', 'image_in', 'tool_use'], support_efforts: ['low', 'high'], default_effort: 'high' })
    expect(getTomlTable(text, 'models."kun/glm-4.6"')).toMatchObject({ model: 'glm-4.6', capabilities: ['tool_use'] })
    expect(h.service.status('kimi', ORIGIN)).toMatchObject({ connected: true, drifted: false, model: 'glm-4.6' })
    h.service.disconnect('kimi', ORIGIN)
    expect(h.read(file)).toBe(CONFIG)
  })
  it('removes tables for models the gateway stopped serving on sync', () => {
    const file = h.write('.kimi-code/config.toml', CONFIG)
    h.service.connect('kimi', wiringTarget('coding'))
    h.service.syncCatalog([{ id: 'coding' }], ORIGIN)
    expect(listTomlTables(h.read(file)).map((parts) => parts.join('/'))).toEqual(['providers/moonshot', 'providers/kun', 'models/kun/coding'])
  })
  it('uses KIMI_CODE_HOME, then an existing legacy ~/.kimi folder', () => {
    const dir = join(h.home, 'kimi-home')
    const custom = wiringHarness({ KIMI_CODE_HOME: dir })
    custom.service.connect('kimi', wiringTarget('coding'))
    expect(custom.exists(join(dir, 'config.toml'))).toBe(true)
    custom.dispose()
    h.write('.kimi/config.toml', CONFIG)
    h.service.connect('kimi', wiringTarget('coding'))
    expect(getTomlTopLevel(h.read(join(h.home, '.kimi', 'config.toml')), 'default_model')).toBe('kun/coding')
  })
})
