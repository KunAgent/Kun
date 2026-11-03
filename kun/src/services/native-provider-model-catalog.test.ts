import { describe, expect, it, vi } from 'vitest'
import { discoverClaudeSdkModels, parseClaudeSdkModelRows, parseCursorSdkModelRows } from './native-provider-model-catalog.js'
import type { SdkApi } from '../runtime/agent-sdk/sdk-protocol.js'

describe('native account model metadata', () => {
  it('prefers the SDK explicit model and preserves effort declarations without parsing capacity from descriptions', () => {
    const result = parseClaudeSdkModelRows([{ value: 'sonnet', resolvedModel: 'claude-current', displayName: 'Sonnet',
      description: 'Opus 4.8 with 1M context', supportedEffortLevels: ['low', 'high'], defaultEffort: 'high' }])
    expect(result.models).toEqual(['claude-current'])
    expect(result.modelProfiles['claude-current'].reasoning).toMatchObject({ supportedEfforts: ['low', 'high'], defaultEffort: 'high' })
    expect(result.modelProfiles['claude-current'].contextWindowTokens).toBeUndefined()
  })
  it('uses the SDK control request with empty prompt and closes its owned handle', async () => {
    const close = vi.fn(), supportedModels = vi.fn(async () => [{ value: 'sonnet', context_window: 200000 }])
    const query = vi.fn((_input: unknown) => ({ close, supportedModels }))
    const result = await discoverClaudeSdkModels({ apiKey: 'sk-ant-oat01-fixture', loadSdk: async () => ({ query }) as unknown as SdkApi })
    expect(result.modelProfiles.sonnet.contextWindowTokens).toBe(200000)
    expect(query.mock.calls[0]?.[0]).toMatchObject({ options: { spawnClaudeCodeProcess: expect.any(Function) } })
    expect(supportedModels).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('activates only a Cursor default variant and retains other variants as conditional', () => {
    const result = parseCursorSdkModelRows([{ id: 'private', displayName: 'Private', variants: [
      { displayName: 'Standard', isDefault: true, params: [{ id: 'context', value: '200k' }] },
      { displayName: 'Extended', params: [{ id: 'context', value: '1m' }] }
    ] }], { apiKeyName: 'Testing', apiKey: 'never-copy', userEmail: 'test@example.test' })
    expect(result.modelProfiles.private.contextWindowTokens).toBe(200000)
    expect(result.modelProfiles.private.conditionalCapabilities).toEqual([{ condition: 'cursor-sdk-variant:Extended', contextWindowTokens: 1000000 }])
    expect(result.account).toEqual({ apiKeyName: 'Testing', userEmail: 'test@example.test' })
  })
})
