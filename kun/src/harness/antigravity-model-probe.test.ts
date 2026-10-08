import { describe, expect, it, vi } from 'vitest'
import { AntigravityModelProbe } from './antigravity-model-probe.js'
import { ANTIGRAVITY_DEFINITION } from './providers/antigravity.js'

const LIST = 'gemini-3.1-pro-high\tGemini 3.1 Pro (High)\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n'

describe('Antigravity model probe', () => {
  it('lists agy models once, caches them and shares in-flight runs', async () => {
    const spawn = vi.fn(async () => ({ stdout: LIST, stderr: '', exitCode: 0, timedOut: false }))
    const probe = new AntigravityModelProbe({ spawn, resolve: async () => '/bin/agy' })
    const [a, b] = await Promise.all([probe.probeCatalog(ANTIGRAVITY_DEFINITION), probe.probeCatalog(ANTIGRAVITY_DEFINITION)])
    expect(a.models).toEqual(['gemini-3.1-pro', 'claude-opus-4-6-thinking'])
    expect(b).toBe(a)
    expect(await probe.probe(ANTIGRAVITY_DEFINITION)).toEqual(a.models)
    expect(probe.peek(ANTIGRAVITY_DEFINITION)).toEqual(a.models)
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0]).toEqual(['/bin/agy', ['models'], expect.objectContaining({ timeoutMs: 30_000 })])
  })
  it('reuses the Check & enable catalog and retries a failed run after invalidation', async () => {
    const spawn = vi.fn(async () => ({ stdout: '', stderr: 'boom', exitCode: 1, timedOut: false }))
    const probe = new AntigravityModelProbe({ spawn, resolve: async () => '/bin/agy' })
    expect((await probe.probeCatalog(ANTIGRAVITY_DEFINITION)).models).toEqual([])
    expect(probe.peek(ANTIGRAVITY_DEFINITION)).toBeUndefined()
    probe.invalidate()
    probe.seed(ANTIGRAVITY_DEFINITION, { models: ['gemini-3.1-pro'], modelInfo: [{ id: 'gemini-3.1-pro' }] })
    expect((await probe.probeCatalog(ANTIGRAVITY_DEFINITION)).models).toEqual(['gemini-3.1-pro'])
    expect(spawn).toHaveBeenCalledOnce()
  })
  it('lists the Agent\'s own models in the composer', () => {
    expect(ANTIGRAVITY_DEFINITION.modelSource).toBe('probe')
  })
})
