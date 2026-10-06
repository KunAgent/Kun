import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDotenv } from './edit/dotenv.js'
import { getJsoncValue, parseJsonc } from './edit/jsonc.js'
import { getTomlTable, getTomlTopLevel } from './edit/toml.js'
import { AgentWiringService, createWiringContext } from './service.js'
import type { WiringTarget } from './types.js'

let home: string
let service: AgentWiringService
const ORIGIN = 'http://127.0.0.1:18899'
const target = (model: string, extra: Partial<WiringTarget> = {}): WiringTarget => ({
  origin: ORIGIN, key: 'kun-agent.kun_local_secret', model,
  models: [{ id: 'coding', displayName: 'Daily coding', contextWindow: 200_000, maxOutputTokens: 32_000, reasoning: true, images: true },
    { id: 'alpha/a1', contextWindow: 128_000 }],
  ...extra
})

function write(path: string, content: string): string {
  const file = join(home, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return file
}
const read = (file: string): string => readFileSync(file, 'utf8')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'kun-agent-wiring-'))
  service = new AgentWiringService(createWiringContext({ home, env: { PATH: '' }, platform: 'darwin',
    stateFile: join(home, '.kun', 'agent-wiring.json'), which: (bin) => bin === 'claude' ? '/usr/local/bin/claude' : undefined }))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('Claude Code', () => {
  const ORIGINAL = `{
  // my settings
  "theme": "dark",
  "model": "opus",
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-mine",
    "DISABLE_TELEMETRY": "1"
  },
  "effortLevel": "medium"
}
`
  it('wires the gateway, switches models and restores the file byte for byte', () => {
    const file = write('.claude/settings.json', ORIGINAL)
    const status = service.connect('claude-code', target('coding', { smallModel: 'alpha/a1', effort: 'high' }), 'gc_1')
    expect(status).toMatchObject({ installed: true, connected: true, drifted: false, model: 'coding', clientId: 'gc_1' })
    const wired = read(file)
    expect(wired).toContain('// my settings')
    expect(getJsoncValue(wired, ['env', 'ANTHROPIC_BASE_URL'])).toBe(ORIGIN)
    expect(getJsoncValue(wired, ['env', 'ANTHROPIC_AUTH_TOKEN'])).toBe('kun-agent.kun_local_secret')
    expect(getJsoncValue(wired, ['env', 'ANTHROPIC_API_KEY'])).toBeUndefined()
    expect(getJsoncValue(wired, ['env', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'])).toBe('alpha/a1')
    expect(getJsoncValue(wired, ['effortLevel'])).toBe('high')
    service.connect('claude-code', target('alpha/a1', { effort: 'max' }))
    const switched = read(file)
    expect(getJsoncValue(switched, ['model'])).toBe('alpha/a1')
    expect(getJsoncValue(switched, ['env', 'CLAUDE_CODE_EFFORT_LEVEL'])).toBe('max')
    expect(getJsoncValue(switched, ['effortLevel'])).toBeUndefined()
    expect(service.currentKey('claude-code', ORIGIN)).toBe('kun-agent.kun_local_secret')
    const { clientId } = service.disconnect('claude-code', ORIGIN)
    expect(clientId).toBe('gc_1')
    expect(read(file)).toBe(ORIGINAL)
    expect(existsSync(`${file}.kun-backup`)).toBe(false)
  })
  it('restores key by key when the user edited the file while connected', () => {
    const file = write('.claude/settings.json', ORIGINAL)
    service.connect('claude-code', target('coding'))
    expect(existsSync(`${file}.kun-backup`)).toBe(true)
    writeFileSync(file, read(file).replace('"theme": "dark"', '"theme": "light"'))
    service.disconnect('claude-code', ORIGIN)
    const restored = parseJsonc(read(file)) as Record<string, any>
    expect(restored).toEqual({ theme: 'light', model: 'opus', env: { ANTHROPIC_API_KEY: 'sk-ant-mine', DISABLE_TELEMETRY: '1' }, effortLevel: 'medium' })
    expect(read(file)).toContain('// my settings')
  })
  it('reports drift when the user points the agent elsewhere', () => {
    const file = write('.claude/settings.json', '{}\n')
    service.connect('claude-code', target('coding'))
    writeFileSync(file, read(file).replace(ORIGIN, 'https://api.anthropic.com'))
    expect(service.status('claude-code', ORIGIN)).toMatchObject({ connected: true, drifted: true })
  })
  it('creates and later removes a settings file it created', () => {
    service.connect('claude-code', target('coding'))
    const file = join(home, '.claude', 'settings.json')
    expect(JSON.parse(read(file)).env.ANTHROPIC_BASE_URL).toBe(ORIGIN)
    service.disconnect('claude-code', ORIGIN)
    expect(existsSync(file)).toBe(false)
  })
  it('rejects an effort the agent cannot express and an unknown agent', () => {
    expect(() => service.connect('claude-code', target('coding', { effort: 'off' }))).toThrow('reasoning')
    expect(() => service.connect('nope', target('coding'))).toThrow('Unknown agent')
    expect(() => service.disconnect('codex', ORIGIN)).toThrow('not connected')
  })
})

describe('Codex', () => {
  const ORIGINAL = `# codex
model = "gpt-5.5"
model_reasoning_effort = "medium"

[model_providers.other]
name = "Other"
base_url = "https://other.example/v1"
`
  it('adds a kun provider table and restores the original keys', () => {
    const file = write('.codex/config.toml', ORIGINAL)
    service.connect('codex', target('coding', { effort: 'max' }))
    const wired = read(file)
    expect(getTomlTopLevel(wired, 'model_provider')).toBe('kun')
    expect(getTomlTopLevel(wired, 'model')).toBe('coding')
    expect(getTomlTopLevel(wired, 'model_reasoning_effort')).toBe('xhigh')
    expect(getTomlTopLevel(wired, 'model_context_window')).toBe(200_000)
    expect(getTomlTable(wired, 'model_providers.kun')).toEqual({ name: 'Kun', base_url: `${ORIGIN}/v1`, wire_api: 'responses',
      experimental_bearer_token: 'kun-agent.kun_local_secret' })
    expect(getTomlTable(wired, 'model_providers.other')).toEqual({ name: 'Other', base_url: 'https://other.example/v1' })
    service.disconnect('codex', ORIGIN)
    expect(read(file)).toBe(ORIGINAL)
  })
})

describe('OpenCode, Pi and Crush keep their own model lists', () => {
  it('writes provider entries with limits and syncs a changed catalog', () => {
    const opencode = write('.config/opencode/opencode.json', '{\n  "$schema": "https://opencode.ai/config.json"\n}\n')
    service.connect('opencode', target('coding', { smallModel: 'alpha/a1' }))
    const config = parseJsonc(read(opencode)) as Record<string, any>
    expect(config.model).toBe('kun/coding')
    expect(config.small_model).toBe('kun/alpha/a1')
    expect(config.provider.kun.models.coding).toEqual({ name: 'Daily coding', limit: { context: 200_000, output: 32_000 }, attachment: true, reasoning: true })
    expect(service.syncCatalog([{ id: 'coding' }, { id: 'beta/b1' }], ORIGIN)).toEqual(['opencode'])
    expect(Object.keys((parseJsonc(read(opencode)) as Record<string, any>).provider.kun.models)).toEqual(['coding', 'beta/b1'])
    service.disconnect('opencode', ORIGIN)
    expect(read(opencode)).toBe('{\n  "$schema": "https://opencode.ai/config.json"\n}\n')
  })
  it('wires Pi across its models and settings files', () => {
    const settings = write('.pi/agent/settings.json', '{\n  "theme": "light"\n}\n')
    service.connect('pi', target('coding', { effort: 'max' }))
    expect(getJsoncValue(read(settings), ['defaultProvider'])).toBe('kun')
    expect(getJsoncValue(read(settings), ['defaultThinkingLevel'])).toBe('xhigh')
    const models = join(home, '.pi', 'agent', 'models.json')
    expect((parseJsonc(read(models)) as Record<string, any>).providers.kun.models[0]).toMatchObject({ id: 'coding', contextWindow: 200_000, maxTokens: 32_000 })
    service.disconnect('pi', ORIGIN)
    expect(read(settings)).toBe('{\n  "theme": "light"\n}\n')
    expect(existsSync(models)).toBe(false)
  })
  it('wires Crush large and small models', () => {
    service.connect('crush', target('coding', { smallModel: 'alpha/a1', effort: 'high' }))
    const config = parseJsonc(read(join(home, '.config', 'crush', 'crush.json'))) as Record<string, any>
    expect(config.models).toEqual({ large: { model: 'coding', provider: 'kun', reasoning_effort: 'high' },
      small: { model: 'alpha/a1', provider: 'kun', reasoning_effort: 'high' } })
    expect(config.providers.kun).toMatchObject({ type: 'openai', base_url: `${ORIGIN}/v1` })
  })
})

describe('Gemini CLI and Droid', () => {
  it('points Gemini CLI at the gateway through settings and .env', () => {
    const env = write('.gemini/.env', 'OTHER=1\nGEMINI_API_KEY=real-google-key\n')
    service.connect('gemini-cli', target('coding'))
    expect(getDotenv(read(env), 'GOOGLE_GEMINI_BASE_URL')).toBe(ORIGIN)
    expect(getDotenv(read(env), 'GEMINI_API_KEY')).toBe('kun-agent.kun_local_secret')
    expect(getJsoncValue(read(join(home, '.gemini', 'settings.json')), ['security', 'auth', 'selectedType'])).toBe('gemini-api-key')
    service.disconnect('gemini-cli', ORIGIN)
    expect(read(env)).toBe('OTHER=1\nGEMINI_API_KEY=real-google-key\n')
  })
  it('adds tagged custom models to Droid and keeps the user\'s own entries', () => {
    const file = write('.factory/config.json', JSON.stringify({ custom_models: [{ model_display_name: 'Mine', model: 'm', base_url: 'https://x', api_key: 'k', provider: 'anthropic' }] }, null, 2) + '\n')
    service.connect('droid', target('coding'))
    const models = (JSON.parse(read(file)) as { custom_models: { model_display_name: string }[] }).custom_models
    expect(models.map((entry) => entry.model_display_name)).toEqual(['Mine', 'Daily coding [Kun]', 'alpha/a1 [Kun]'])
    service.connect('droid', target('coding', { models: [{ id: 'beta/b1' }] }))
    expect((JSON.parse(read(file)) as { custom_models: unknown[] }).custom_models).toHaveLength(2)
    service.disconnect('droid', ORIGIN)
    expect((JSON.parse(read(file)) as { custom_models: { model_display_name: string }[] }).custom_models.map((entry) => entry.model_display_name)).toEqual(['Mine'])
  })
})

describe('profiles and detection', () => {
  it('saves the connected agents\' models under a name', () => {
    service.connect('codex', target('coding', { effort: 'high' }))
    service.connect('opencode', target('alpha/a1'))
    expect(service.saveProfile('Focus')).toEqual({ codex: { model: 'coding', effort: 'high' }, opencode: { model: 'alpha/a1' } })
    expect(service.listProfiles()).toHaveProperty('Focus')
    expect(() => service.saveProfile('../bad')).toThrow()
    service.deleteProfile('Focus')
    expect(service.listProfiles()).toEqual({})
  })
  it('detects agents by binary or config folder', () => {
    write('.codex/config.toml', '')
    const rows = service.list(ORIGIN)
    expect(rows.find((row) => row.id === 'claude-code')).toMatchObject({ installed: true, binary: '/usr/local/bin/claude' })
    expect(rows.find((row) => row.id === 'codex')).toMatchObject({ installed: true })
    expect(rows.find((row) => row.id === 'crush')).toMatchObject({ installed: false, connected: false })
  })
  it('leaves files untouched when a config cannot be parsed', () => {
    const file = write('.claude/settings.json', '{ "broken": ')
    expect(() => service.connect('claude-code', target('coding'))).toThrow('Could not update')
    expect(read(file)).toBe('{ "broken": ')
    expect(service.status('claude-code', ORIGIN).connected).toBe(false)
  })
})
