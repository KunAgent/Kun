import { describe, expect, it } from 'vitest'
import { isOpenCodeGo } from './compat-model-support.js'

describe('isOpenCodeGo', () => {
  it('matches the stable preset source', () => {
    expect(isOpenCodeGo({ presetSource: 'opencode-go', providerId: 'custom', baseUrl: 'https://example.test' })).toBe(true)
  })

  it('matches a multi-account preset id', () => {
    expect(isOpenCodeGo({ providerId: 'opencode-go-2', baseUrl: 'https://example.test' })).toBe(true)
  })

  it('matches the official Go URL', () => {
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/go/v1' })).toBe(true)
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/go' })).toBe(true)
  })

  it('does not match the OpenCode Free path', () => {
    expect(isOpenCodeGo({ presetSource: 'opencode-free', baseUrl: 'https://opencode.ai/zen/v1' })).toBe(false)
  })

  it('does not match a lookalike path or host', () => {
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/go-something/v1' })).toBe(false)
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/gov1' })).toBe(false)
    expect(isOpenCodeGo({ baseUrl: 'https://fake-opencode.ai/zen/go/v1' })).toBe(false)
    expect(isOpenCodeGo({ baseUrl: 'http://opencode.ai/zen/go/v1' })).toBe(false)
  })
})
