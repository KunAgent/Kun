import { describe, expect, it } from 'vitest'
import { getJsoncValue, parseJsonc, setJsoncValue } from './jsonc.js'
import { getTomlTable, getTomlTopLevel, setTomlTable, setTomlTopLevel } from './toml.js'
import { getDotenv, setDotenv } from './dotenv.js'

const SETTINGS = `{
  // user comment kept
  "theme": "dark",
  "env": {
    "FOO": "bar" /* inline */
  },
  "permissions": { "allow": ["Bash(ls)"] },
}
`

describe('jsonc editor', () => {
  it('parses comments and trailing commas', () => {
    expect(parseJsonc(SETTINGS)).toEqual({ theme: 'dark', env: { FOO: 'bar' }, permissions: { allow: ['Bash(ls)'] } })
  })
  it('sets nested values without touching anything else, and round-trips by deleting', () => {
    const set = setJsoncValue(SETTINGS, ['env', 'ANTHROPIC_BASE_URL'], 'http://127.0.0.1:18899')
    expect(set).toContain('// user comment kept')
    expect(set).toContain('"FOO": "bar", /* inline */\n    "ANTHROPIC_BASE_URL"')
    expect(getJsoncValue(set, ['env', 'ANTHROPIC_BASE_URL'])).toBe('http://127.0.0.1:18899')
    const restored = setJsoncValue(set, ['env', 'ANTHROPIC_BASE_URL'], undefined)
    expect(parseJsonc(restored)).toEqual(parseJsonc(SETTINGS))
    expect(restored).toContain('// user comment kept')
  })
  it('replaces existing values in place and creates missing parents', () => {
    const replaced = setJsoncValue(SETTINGS, ['theme'], 'light')
    expect(replaced).toBe(SETTINGS.replace('"dark"', '"light"'))
    const created = setJsoncValue(SETTINGS, ['provider', 'kun', 'options'], { baseURL: 'x' })
    expect(getJsoncValue(created, ['provider', 'kun', 'options', 'baseURL'])).toBe('x')
    expect(created.endsWith('}\n')).toBe(true)
  })
  it('keeps strict JSON valid when the last property is removed', () => {
    const strict = '{\n  "a": 1,\n  "b": 2\n}\n'
    const out = setJsoncValue(strict, ['b'], undefined)
    expect(JSON.parse(out)).toEqual({ a: 1 })
    expect(out).toBe('{\n  "a": 1\n}\n')
    expect(JSON.parse(setJsoncValue(strict, ['a'], undefined))).toEqual({ b: 2 })
  })
  it('preserves CRLF line endings and creates a file from scratch', () => {
    const crlf = '{\r\n  "a": 1\r\n}\r\n'
    expect(setJsoncValue(crlf, ['b'], true)).toBe('{\r\n  "a": 1,\r\n  "b": true\r\n}\r\n')
    expect(JSON.parse(setJsoncValue('', ['env', 'X'], '1'))).toEqual({ env: { X: '1' } })
    expect(setJsoncValue('{}', ['x'], 1)).toBe('{\n  "x": 1\n}')
  })
  it('refuses to edit through a non-object and rejects broken files', () => {
    expect(() => setJsoncValue('{"env": "string"}', ['env', 'X'], 1)).toThrow('not an object')
    expect(() => parseJsonc('{"a": }')).toThrow()
  })
})

const CONFIG = `# Codex config
model = "gpt-5.5"
approval_policy = "on-request"

[model_providers.other]
name = "Other"
base_url = "https://other.example/v1"

[profiles.fast]
model = "gpt-5.4-mini"
prompt = """
not a [header]
"""
`

describe('toml editor', () => {
  it('reads and sets top-level keys before the first table', () => {
    expect(getTomlTopLevel(CONFIG, 'model')).toBe('gpt-5.5')
    expect(getTomlTopLevel(CONFIG, 'name')).toBeUndefined()
    const set = setTomlTopLevel(CONFIG, 'model_provider', 'kun')
    expect(set.indexOf('model_provider = "kun"')).toBeLessThan(set.indexOf('[model_providers.other]'))
    expect(setTomlTopLevel(set, 'model_provider', undefined)).toBe(CONFIG)
    expect(setTomlTopLevel(CONFIG, 'model', 'coding')).toBe(CONFIG.replace('model = "gpt-5.5"', 'model = "coding"'))
  })
  it('adds, replaces and removes whole tables, ignoring brackets inside multi-line strings', () => {
    const added = setTomlTable(CONFIG, 'model_providers.kun', { name: 'Kun', base_url: 'http://127.0.0.1:18899/v1', wire_api: 'responses' })
    expect(getTomlTable(added, 'model_providers.kun')).toEqual({ name: 'Kun', base_url: 'http://127.0.0.1:18899/v1', wire_api: 'responses' })
    expect(getTomlTable(added, 'profiles.fast')).toEqual({ model: 'gpt-5.4-mini' })
    const replaced = setTomlTable(added, 'model_providers.kun', { name: 'Kun 2' })
    expect(getTomlTable(replaced, 'model_providers.kun')).toEqual({ name: 'Kun 2' })
    expect(setTomlTable(added, 'model_providers.kun', undefined)).toBe(CONFIG)
    expect(getTomlTable(CONFIG, 'header')).toBeUndefined()
  })
  it('writes inline tables for header maps and quotes odd keys', () => {
    const out = setTomlTable('', 'model_providers.kun', { http_headers: { 'x-kun-agent': 'codex' } })
    expect(out).toBe('[model_providers.kun]\nhttp_headers = { x-kun-agent = "codex" }\n')
  })
})

describe('dotenv editor', () => {
  it('sets, replaces and removes keys while keeping other lines', () => {
    const text = '# keys\nFOO=1\nGEMINI_API_KEY=old # comment\n'
    expect(getDotenv(text, 'GEMINI_API_KEY')).toBe('old')
    const set = setDotenv(text, 'GEMINI_API_KEY', 'new')
    expect(set).toBe('# keys\nFOO=1\nGEMINI_API_KEY=new\n')
    expect(setDotenv(set, 'GOOGLE_GEMINI_BASE_URL', 'http://127.0.0.1:18899')).toContain('GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:18899\n')
    expect(setDotenv(set, 'GEMINI_API_KEY', undefined)).toBe('# keys\nFOO=1\n')
    expect(setDotenv('', 'A', 'has space')).toBe('A="has space"\n')
  })
})
