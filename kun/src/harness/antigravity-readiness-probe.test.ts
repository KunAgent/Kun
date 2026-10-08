import { describe, expect, it } from 'vitest'
import { agyModelCatalog, agyModelIds, agyModelsHandshake } from './antigravity-readiness-probe.js'

const LIST = 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n'

describe('agy models readiness', () => {
  it('reads model ids from the first column only', () => {
    expect(agyModelIds(LIST)).toEqual(['gemini-3.8-flash-high', 'claude-sonnet-4-6', 'gpt-oss-120b-medium'])
    expect(agyModelIds('Fetching available models...\n')).toEqual([])
  })
  it('accepts a complete list, also when agy was still shutting down its language server', () => {
    expect(agyModelsHandshake({ stdout: LIST, stderr: 'Fetching available models...', exitCode: 0, timedOut: false }))
      .toMatchObject({ ok: true, supported: true, protocol: 'antigravity-models', models: expect.any(Array), detail: 'Local agy models check; no model prompt sent' })
    expect(agyModelsHandshake({ stdout: LIST, stderr: '', exitCode: null, timedOut: true }).ok).toBe(true)
  })
  it('says why the check failed', () => {
    expect(agyModelsHandshake({ stdout: '', stderr: 'Fetching available models...', exitCode: null, timedOut: true }).detail)
      .toMatch(/^agy models did not finish within 30s\. Run `agy models` in a terminal/)
    expect(agyModelsHandshake({ stdout: '', stderr: 'error: not logged in\n', exitCode: 1, timedOut: false }))
      .toMatchObject({ ok: false, detail: 'agy models exited with code 1: error: not logged in' })
    expect(agyModelsHandshake({ stdout: 'Fetching available models...\n', stderr: '', exitCode: 0, timedOut: false }).detail)
      .toMatch(/^agy models listed no models/)
  })
})

describe('agy model catalog', () => {
  it('folds per-effort rows into base models with their effort levels', () => {
    const out = 'Fetching available models...\n' + LIST + 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n'
    expect(agyModelCatalog(out)).toEqual({
      models: ['gemini-3.8-flash', 'claude-sonnet-4-6', 'gpt-oss-120b'],
      modelInfo: [
        { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', reasoningEfforts: ['low', 'medium', 'high'] },
        { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', reasoningEfforts: [] },
        { id: 'gpt-oss-120b', displayName: 'GPT-OSS 120B', reasoningEfforts: ['medium'] }
      ]
    })
  })
  it('hands Check & enable the catalog and accepts base and per-effort ids', () => {
    const result = agyModelsHandshake({ stdout: LIST, stderr: '', exitCode: 0, timedOut: false })
    expect(result.catalog?.models).toEqual(['gemini-3.8-flash', 'claude-sonnet-4-6', 'gpt-oss-120b'])
    expect(result.models).toEqual(expect.arrayContaining(['gemini-3.8-flash', 'gemini-3.8-flash-high', 'gpt-oss-120b-medium']))
  })
})
