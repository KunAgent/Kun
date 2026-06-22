import { describe, expect, it } from 'vitest'
import { allBuiltinToolNames } from './builtin-tool-types.js'

describe('builtin lsp registration', () => {
  it('includes lsp in the builtin tool name catalog', () => {
    expect(allBuiltinToolNames.has('lsp')).toBe(true)
  })
})
