import { describe, expect, it, vi } from 'vitest'
import { discoverGeminiCliModels, parseGeminiCliAccountModels } from './gemini-cli-model-catalog.js'

const tokenSource = { accessToken: async () => 'fixture-token' }
const fallbackModels = ['gemini-fallback']
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status })

describe('Gemini CLI account model discovery', () => {
  it('uses only explicit Gemini IDs from quota and keeps duplicates merged', () => {
    expect(parseGeminiCliAccountModels({ buckets: [
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.5 },
      { modelId: 'gemini-2.5-pro', max_input_tokens: 100_000 },
      { modelId: 'claude-sonnet' }, { label: 'gemini-guessed' }
    ] })).toMatchObject({ models: ['gemini-2.5-pro'], source: 'provider',
      modelProfiles: { 'gemini-2.5-pro': { maxInputTokens: 100_000 } } })
  })
  it('reuses the official CLI project and account quota channel', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ cloudaicompanionProject: 'project' }))
      .mockResolvedValueOnce(json({ buckets: [{ modelId: 'gemini-2.5-flash' }] }))
    const result = await discoverGeminiCliModels({ tokenSource, fallbackModels, fetchImpl })
    expect(result.models).toEqual(['gemini-2.5-flash'])
    expect(fetchImpl.mock.calls[1][0]).toContain(':retrieveUserQuota')
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ project: 'project' })
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('ANTIGRAVITY')
  })
  it('keeps an explicitly empty account catalog empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ cloudaicompanionProject: 'project' }))
      .mockResolvedValueOnce(json({ buckets: [] }))
    expect((await discoverGeminiCliModels({ tokenSource, fallbackModels, fetchImpl })).models).toEqual([])
  })
  it('does not disguise authentication failures as a preset success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 403))
    await expect(discoverGeminiCliModels({ tokenSource, fallbackModels, fetchImpl })).rejects.toThrow('403')
  })
  it('labels a temporary failure as an unverified preset fallback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 503))
    expect(await discoverGeminiCliModels({ tokenSource, fallbackModels, fetchImpl }))
      .toMatchObject({ models: fallbackModels, source: 'preset', lastAttemptStatus: 'fallback' })
  })
})
