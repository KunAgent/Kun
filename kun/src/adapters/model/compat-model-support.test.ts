import { describe, expect, it } from 'vitest'
import { isOpenCodeFree, isOpenCodeGo } from './compat-model-support.js'

describe('compat-model-support OpenCode identity re-exports', () => {
  it('keeps Go and Free distinct', () => {
    expect(isOpenCodeGo({ presetSource: 'opencode-go', baseUrl: 'https://example.test' })).toBe(true)
    expect(isOpenCodeFree({ presetSource: 'opencode-free', baseUrl: 'https://opencode.ai/zen/v1' })).toBe(true)
    expect(isOpenCodeGo({ presetSource: 'opencode-free', baseUrl: 'https://opencode.ai/zen/v1' })).toBe(false)
  })
})
