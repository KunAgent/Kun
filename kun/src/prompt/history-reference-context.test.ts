import { describe, expect, it } from 'vitest'
import { historyReferenceContextBlocks, historyReferenceInstructions } from './history-reference-context.js'

describe('source history context', () => {
  it('does not inject anything for native threads', () => {
    expect(historyReferenceContextBlocks({})).toEqual([])
  })

  it('contains only a reference, never an automatic transcript or summary', () => {
    const thread = { historyRefId: 'hist_fixed', title: 'PRIVATE_TITLE', summary: 'PRIVATE_SUMMARY',
      turns: [{ text: 'PRIVATE_TRANSCRIPT' }] }
    const blocks = historyReferenceContextBlocks(thread)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.authority).toBe('reference')
    expect(blocks[0]?.content).toContain('hist_fixed')
    expect(blocks[0]?.content).toContain('NOT been loaded')
    expect(JSON.stringify(blocks)).not.toContain('PRIVATE_')
    expect(historyReferenceInstructions(thread)).toEqual(historyReferenceInstructions(thread))
  })
})
