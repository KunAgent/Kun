import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getYamlValue } from './edit/yaml.js'
import { OWNED_SUFFIX } from './adapters-extra.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

const CONFIG = `name: My Assistant
version: 1.0.0
schema: v1
models:
  # my local model
  - name: Ollama
    provider: ollama
    model: llama3
`

describe('Continue adapter', () => {
  it('appends tagged models, chosen one first, and keeps the user list', () => {
    const file = h.write('.continue/config.yaml', CONFIG)
    h.service.connect('continue', wiringTarget('glm-4.6'))
    const models = getYamlValue(h.read(file), ['models']) as Record<string, unknown>[]
    expect(models.map((model) => model.name)).toEqual(['Ollama', `glm-4.6${OWNED_SUFFIX}`, `Daily coding${OWNED_SUFFIX}`])
    expect(models[2]).toMatchObject({ provider: 'openai', model: 'coding', apiBase: `${ORIGIN}/v1`, apiKey: KEY,
      capabilities: ['tool_use', 'image_input'], defaultCompletionOptions: { contextLength: 200_000, maxTokens: 32_000 } })
    expect(h.read(file)).toContain('# my local model')
    expect(h.service.status('continue', ORIGIN)).toMatchObject({ connected: true, drifted: false, model: 'glm-4.6', pickInAgent: true })
    h.service.disconnect('continue', ORIGIN)
    expect(h.read(file)).toBe(CONFIG)
  })
  it('creates a valid config when none exists and removes it again', () => {
    h.service.connect('continue', wiringTarget('coding'))
    const file = join(h.home, '.continue', 'config.yaml')
    expect(getYamlValue(h.read(file), ['name'])).toBe('Kun')
    expect(getYamlValue(h.read(file), ['schema'])).toBe('v1')
    h.service.disconnect('continue', ORIGIN)
    expect(h.exists(file)).toBe(false)
  })
  it('drops only tagged entries when the user changed the file', () => {
    const file = h.write('.continue/config.yaml', CONFIG)
    h.service.connect('continue', wiringTarget('coding'))
    h.write('.continue/config.yaml', h.read(file).replace('name: My Assistant', 'name: Renamed'))
    h.service.disconnect('continue', ORIGIN)
    expect(getYamlValue(h.read(file), ['name'])).toBe('Renamed')
    expect((getYamlValue(h.read(file), ['models']) as unknown[]).length).toBe(1)
  })
})
