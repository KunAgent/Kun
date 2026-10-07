import { describe, expect, it } from 'vitest'
import { workFileKindForName } from './WorkFileTypeIcon'

describe('workFileKindForName', () => {
  it('maps office formats to the tile users recognise', () => {
    expect(workFileKindForName('季度汇报.pptx')).toBe('slide')
    expect(workFileKindForName('预算.XLSX')).toBe('sheet')
    expect(workFileKindForName('data.csv')).toBe('sheet')
    expect(workFileKindForName('合同.docx')).toBe('word')
    expect(workFileKindForName('paper.pdf')).toBe('pdf')
    expect(workFileKindForName('cover.png')).toBe('image')
    expect(workFileKindForName('notes.md')).toBe('markdown')
  })

  it('falls back for unknown or missing extensions', () => {
    expect(workFileKindForName('LICENSE')).toBe('markdown')
    expect(workFileKindForName('archive.zip', 'code')).toBe('code')
  })
})
