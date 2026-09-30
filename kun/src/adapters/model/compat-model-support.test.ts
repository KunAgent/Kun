import { describe, expect, it } from 'vitest'
import { isOpenCodeGo } from './compat-model-support.js'

describe('compat-model-support OpenCode identity re-exports', () => {
  it('identifies OpenCode Go without treating zen/v1 as Go', () => {
    expect(isOpenCodeGo({ presetSource: 'opencode-go', baseUrl: 'https://example.test' })).toBe(true)
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/v1' })).toBe(false)
  })
})
