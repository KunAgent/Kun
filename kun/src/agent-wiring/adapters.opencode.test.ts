import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getJsoncValue } from './edit/jsonc.js'
import { ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

describe('OpenCode adapter', () => {
  it('follows XDG_CONFIG_HOME', () => {
    const dir = join(h.home, 'xdg')
    const custom = wiringHarness({ XDG_CONFIG_HOME: dir })
    custom.service.connect('opencode', wiringTarget('coding'))
    expect(getJsoncValue(custom.read(join(dir, 'opencode', 'opencode.json')), ['model'])).toBe('kun/coding')
    custom.dispose()
  })
  it('writes limits, attachments and the small model', () => {
    const file = h.write('.config/opencode/opencode.json', '{\n  // mine\n  "theme": "tokyonight"\n}\n')
    h.service.connect('opencode', wiringTarget('coding', { smallModel: 'glm-4.6' }))
    const text = h.read(file)
    expect(text).toContain('// mine')
    expect(getJsoncValue(text, ['model'])).toBe('kun/coding')
    expect(getJsoncValue(text, ['small_model'])).toBe('kun/glm-4.6')
    expect(getJsoncValue(text, ['provider', 'kun', 'models', 'coding'])).toEqual({ name: 'Daily coding', limit: { context: 200_000, output: 32_000 },
      attachment: true, reasoning: true })
    expect(h.service.status('opencode', ORIGIN)).toMatchObject({ connected: true, drifted: false, model: 'coding' })
  })
  it('keeps the user edit and drops only Kun keys on disconnect', () => {
    const file = h.write('.config/opencode/opencode.json', '{\n  "theme": "tokyonight"\n}\n')
    h.service.connect('opencode', wiringTarget('coding'))
    h.write('.config/opencode/opencode.json', h.read(file).replace('"tokyonight"', '"nord"'))
    h.service.disconnect('opencode', ORIGIN)
    const text = h.read(file)
    expect(getJsoncValue(text, ['theme'])).toBe('nord')
    expect(getJsoncValue(text, ['provider'])).toBeUndefined()
    expect(getJsoncValue(text, ['model'])).toBeUndefined()
  })
})
