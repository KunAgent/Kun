import { describe, expect, it } from 'vitest'
import { getTomlTable, listTomlTables, setTomlTable, splitTomlKey, tomlTableName } from './toml.js'
import { getYamlValue, setYamlValue } from './yaml.js'

describe('yaml editor', () => {
  const SOURCE = `# Goose settings
GOOSE_PROVIDER: openai # current
GOOSE_MODEL: gpt-5
extensions:
  developer:
    enabled: true
`
  it('reads and writes top-level and nested keys while keeping comments', () => {
    expect(getYamlValue(SOURCE, ['GOOSE_PROVIDER'])).toBe('openai')
    expect(getYamlValue(SOURCE, ['extensions', 'developer'])).toEqual({ enabled: true })
    const next = setYamlValue(SOURCE, ['GOOSE_PROVIDER'], 'kun')
    expect(next).toContain('# Goose settings')
    expect(next).toContain('GOOSE_PROVIDER: kun # current')
    expect(next).toContain('extensions:\n  developer:\n    enabled: true')
    expect(setYamlValue(setYamlValue(next, ['GOOSE_PROVIDER'], 'openai'), ['GOOSE_MODEL'], 'gpt-5')).toBe(SOURCE)
  })
  it('creates a document, deletes keys and leaves an emptied file blank', () => {
    const created = setYamlValue('', ['models'], [{ name: 'a [Kun]', roles: ['chat'] }])
    expect(getYamlValue(created, ['models'])).toEqual([{ name: 'a [Kun]', roles: ['chat'] }])
    expect(setYamlValue(created, ['models'], undefined)).toBe('')
    expect(setYamlValue(SOURCE, ['missing'], undefined)).toBe(SOURCE)
  })
  it('refuses anchors, several documents and broken files', () => {
    expect(() => setYamlValue('base: &b { a: 1 }\nother: *b\n', ['x'], 1)).toThrow(/anchors/)
    expect(() => setYamlValue('a: 1\n---\nb: 2\n', ['x'], 1)).toThrow(/several documents/)
    expect(() => getYamlValue('a: [1,\n', ['a'])).toThrow(/parse error/)
    expect(() => setYamlValue('- a\n- b\n', ['x'], 1)).toThrow(/not a mapping/)
  })
})

describe('toml table names and arrays', () => {
  it('keeps dots inside quoted parts', () => {
    expect(splitTomlKey('models."kun/glm-4.6"')).toEqual(['models', 'kun/glm-4.6'])
    expect(splitTomlKey("a . 'b.c' . d")).toEqual(['a', 'b.c', 'd'])
    expect(tomlTableName(['models', 'kun/glm-4.6'])).toBe('models."kun/glm-4.6"')
  })
  it('writes, reads, lists and removes tables whose names contain dots, with string arrays', () => {
    const name = tomlTableName(['models', 'kun/glm-4.6'])
    const text = setTomlTable('default_model = "x"\n', name, { provider: 'kun', capabilities: ['thinking', 'tool_use'], max_context_size: 128000 })
    expect(text).toContain('[models."kun/glm-4.6"]\nprovider = "kun"\ncapabilities = ["thinking", "tool_use"]')
    expect(getTomlTable(text, name)).toEqual({ provider: 'kun', capabilities: ['thinking', 'tool_use'], max_context_size: 128000 })
    expect(getTomlTable(text, 'models.kun/glm-4')).toBeUndefined()
    expect(listTomlTables(text)).toEqual([['models', 'kun/glm-4.6']])
    expect(setTomlTable(text, name, undefined)).toBe('default_model = "x"\n')
  })
})
