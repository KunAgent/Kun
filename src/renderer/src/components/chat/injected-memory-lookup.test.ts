import { describe, expect, it } from 'vitest'
import { resolveInjectedMemoryTooltipLines } from './injected-memory-lookup'

describe('resolveInjectedMemoryTooltipLines', () => {
  it('prefers turn metadata summaries over live lookup', () => {
    const lines = resolveInjectedMemoryTooltipLines(
      {
        injectedMemorySummaries: [{ id: 'mem_1', content: 'User prefers dark mode.' }]
      },
      ['mem_1'],
      new Map([['mem_1', 'Stale lookup value']])
    )

    expect(lines).toEqual(['User prefers dark mode.'])
  })

  it('falls back to live lookup and numbers multiple memories', () => {
    const lines = resolveInjectedMemoryTooltipLines(
      undefined,
      ['mem_1', 'mem_2'],
      new Map([
        ['mem_1', 'First memory'],
        ['mem_2', 'Second memory']
      ])
    )

    expect(lines).toEqual(['1. First memory', '2. Second memory'])
  })
})
