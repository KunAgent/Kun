import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTomlTable, getTomlTopLevel } from './edit/toml.js'
import { ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

const ORIGINAL = `# my codex config
model = "gpt-5" # default
approval_policy = "on-request"

[model_providers.openai-proxy]
name = "Proxy"
base_url = "https://proxy.example/v1"

[profiles.fast]
model = "gpt-5-mini"
`

describe('Codex adapter', () => {
  it('honors CODEX_HOME', () => {
    const dir = join(h.home, 'codex-home')
    const custom = wiringHarness({ CODEX_HOME: dir })
    custom.service.connect('codex', wiringTarget('coding'))
    expect(getTomlTopLevel(custom.read(join(dir, 'config.toml')), 'model')).toBe('coding')
    custom.dispose()
  })
  it('keeps comments and other tables', () => {
    const file = h.write('.codex/config.toml', ORIGINAL)
    h.service.connect('codex', wiringTarget('coding', { effort: 'max' }))
    const text = h.read(file)
    expect(text).toContain('# my codex config')
    expect(text).toContain('[profiles.fast]')
    expect(getTomlTopLevel(text, 'model_provider')).toBe('kun')
    expect(getTomlTopLevel(text, 'model_reasoning_effort')).toBe('xhigh')
    expect(getTomlTable(text, 'model_providers.kun')).toMatchObject({ base_url: `${ORIGIN}/v1`, wire_api: 'responses' })
  })
  it('restores key by key after the user edits the file while connected', () => {
    const file = h.write('.codex/config.toml', ORIGINAL)
    h.service.connect('codex', wiringTarget('coding'))
    h.write('.codex/config.toml', h.read(file).replace('approval_policy = "on-request"', 'approval_policy = "never"'))
    h.service.disconnect('codex', ORIGIN)
    const text = h.read(file)
    expect(text).toContain('approval_policy = "never"')
    expect(getTomlTopLevel(text, 'model')).toBe('gpt-5')
    expect(getTomlTopLevel(text, 'model_provider')).toBeUndefined()
    expect(getTomlTable(text, 'model_providers.kun')).toBeUndefined()
    expect(text).toContain('[model_providers.openai-proxy]')
  })
  it('reports drift when the user switches model_provider back', () => {
    const file = h.write('.codex/config.toml', ORIGINAL)
    h.service.connect('codex', wiringTarget('coding'))
    h.write('.codex/config.toml', h.read(file).replace('model_provider = "kun"', 'model_provider = "openai-proxy"'))
    expect(h.service.status('codex', ORIGIN)).toMatchObject({ connected: true, drifted: true })
  })
})
