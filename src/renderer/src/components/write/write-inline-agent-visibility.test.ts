import { describe, expect, it } from 'vitest'
import type { WriteEditorSelectionState } from './write-markdown-editor-types'
import { shouldShowWriteInlineAgent } from './write-inline-agent-visibility'

function selection(sourceKind: WriteEditorSelectionState['sourceKind']): WriteEditorSelectionState {
  return { text: 'selected', ranges: [], charCount: 8, sourceKind }
}

describe('shouldShowWriteInlineAgent', () => {
  it('keeps spreadsheet selections out of the global inline menu', () => {
    expect(shouldShowWriteInlineAgent(selection('spreadsheet'), false)).toBe(false)
  })

  it('keeps the existing inline menu for non-spreadsheet selections', () => {
    expect(shouldShowWriteInlineAgent(selection('text'), false)).toBe(true)
    expect(shouldShowWriteInlineAgent(selection('word'), false)).toBe(true)
    expect(shouldShowWriteInlineAgent(selection('pdf'), false)).toBe(true)
    expect(shouldShowWriteInlineAgent(selection('presentation'), false)).toBe(true)
  })

  it('waits for non-spreadsheet pointer selection to settle', () => {
    expect(shouldShowWriteInlineAgent(selection('text'), true)).toBe(false)
  })
})
