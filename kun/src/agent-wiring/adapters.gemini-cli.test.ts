import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDotenv } from './edit/dotenv.js'
import { getJsoncValue } from './edit/jsonc.js'
import { KEY, ORIGIN, wiringHarness, wiringTarget, type WiringHarness } from './wiring-test-support.js'

let h: WiringHarness
beforeEach(() => { h = wiringHarness() })
afterEach(() => h.dispose())

describe('Gemini CLI adapter', () => {
  it('selects API-key auth, names the model and points .env at the gateway origin', () => {
    const settings = h.write('.gemini/settings.json', '{ "ui": { "theme": "GitHub" } }\n')
    const env = h.write('.gemini/.env', '# keep me\nGEMINI_API_KEY=mine\nOTHER=1\n')
    h.service.connect('gemini-cli', wiringTarget('coding'))
    expect(getJsoncValue(h.read(settings), ['security', 'auth', 'selectedType'])).toBe('gemini-api-key')
    expect(getJsoncValue(h.read(settings), ['model', 'name'])).toBe('coding')
    expect(getDotenv(h.read(env), 'GEMINI_API_KEY')).toBe(KEY)
    // Gemini CLI appends /v1beta itself, so the base is the bare origin.
    expect(getDotenv(h.read(env), 'GOOGLE_GEMINI_BASE_URL')).toBe(ORIGIN)
    expect(h.service.status('gemini-cli', ORIGIN)).toMatchObject({ connected: true, drifted: false, model: 'coding' })
    h.service.disconnect('gemini-cli', ORIGIN)
    expect(h.read(env)).toBe('# keep me\nGEMINI_API_KEY=mine\nOTHER=1\n')
    expect(h.read(settings)).toBe('{ "ui": { "theme": "GitHub" } }\n')
  })
  it('restores per key when the user changed .env while connected', () => {
    const env = h.write('.gemini/.env', 'GEMINI_API_KEY=mine\n')
    h.service.connect('gemini-cli', wiringTarget('coding'))
    h.write('.gemini/.env', `${h.read(env)}EXTRA=yes\n`)
    h.service.disconnect('gemini-cli', ORIGIN)
    expect(getDotenv(h.read(env), 'GEMINI_API_KEY')).toBe('mine')
    expect(getDotenv(h.read(env), 'GOOGLE_GEMINI_BASE_URL')).toBeUndefined()
    expect(getDotenv(h.read(env), 'EXTRA')).toBe('yes')
  })
})
