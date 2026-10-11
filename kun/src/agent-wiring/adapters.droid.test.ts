import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DROID_SUFFIX } from './adapters.js'
import { getJsoncValue } from './edit/jsonc.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

const mine = { model_display_name: 'My local', model: 'llama', base_url: 'http://localhost:11434/v1', api_key: 'x', provider: 'generic-chat-completion-api', max_tokens: 8000 }

describe('Droid adapter', () => {
  it('adds tagged entries, replaces them on sync and keeps entries the user added later', () => {
    const file = h.write('.factory/config.json', JSON.stringify({ custom_models: [mine] }, null, 2) + '\n')
    h.service.connect('droid', wiringTarget('coding'))
    let entries = getJsoncValue(h.read(file), ['custom_models']) as { model_display_name: string; api_key: string }[]
    expect(entries.map((entry) => entry.model_display_name)).toEqual(['My local', `Daily coding${DROID_SUFFIX}`, `glm-4.6${DROID_SUFFIX}`])
    expect(entries[1]!.api_key).toBe(KEY)
    h.service.syncCatalog([{ id: 'coding', displayName: 'Daily coding' }], ORIGIN)
    entries = getJsoncValue(h.read(file), ['custom_models']) as typeof entries
    expect(entries).toHaveLength(2)
    const later = { ...mine, model_display_name: 'Added later' }
    const current = getJsoncValue(h.read(file), ['custom_models']) as unknown[]
    h.write('.factory/config.json', JSON.stringify({ custom_models: [...current, later] }, null, 2) + '\n')
    h.service.disconnect('droid', ORIGIN)
    entries = getJsoncValue(h.read(file), ['custom_models']) as typeof entries
    expect(entries.map((entry) => entry.model_display_name)).toEqual(['My local', 'Added later'])
  })
  it('asks the user to pick the model inside Droid', () => {
    expect(h.service.status('droid', ORIGIN)).toMatchObject({ pickInAgent: true, keepsModelList: true })
  })
})
