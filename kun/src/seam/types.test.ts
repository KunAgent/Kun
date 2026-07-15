import { describe, it, expect } from 'vitest'
import { LOOP_HOOK_NAMES } from './types.js'

describe('seam contract types', () => {
  it('exposes stable loop hook names', () => {
    expect(LOOP_HOOK_NAMES).toEqual(['beforeLoop', 'afterModelSelect', 'beforeToolCall', 'afterTurn'])
  })
})
