import { describe, expect, it } from 'vitest'
import { agyModelIds, agyModelsHandshake } from './antigravity-readiness-probe.js'

const LIST = 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n'

describe('agy models readiness', () => {
  it('reads model ids from the first column only', () => {
    expect(agyModelIds(LIST)).toEqual(['gemini-3.8-flash-high', 'claude-sonnet-4-6', 'gpt-oss-120b-medium'])
    expect(agyModelIds('Fetching available models...\n')).toEqual([])
  })
  it('accepts a complete list, also when agy was still shutting down its language server', () => {
    expect(agyModelsHandshake({ stdout: LIST, stderr: 'Fetching available models...', exitCode: 0, timedOut: false }))
      .toEqual({ ok: true, supported: true, protocol: 'antigravity-models', models: expect.any(Array), detail: 'Local agy models check; no model prompt sent' })
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
