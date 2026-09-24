import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  findPaperUnitDir,
  nextInterpretationFileName,
  paperUnitDirForFile,
  paperUnitDirFromKnownUnits,
  paperUnitSlugFromDir
} from './paper-unit'
import { paperBoardSlug } from './paper-interpret-prompt'

const ROOT = '/ws'
const file = (name: string): WorkspaceEntry => ({ name, path: name, type: 'file', ext: '' })
const dir = (name: string): WorkspaceEntry => ({ name, path: name, type: 'directory', ext: '' })

describe('findPaperUnitDir', () => {
  it('walks ancestors until a directory containing paper.json', () => {
    const entries: Record<string, WorkspaceEntry[]> = {
      '/ws/papers/1706.03762': [file('paper.json'), file('1706.03762.pdf'), dir('figures')],
      '/ws/papers/1706.03762/figures': [file('fig-1.png')]
    }
    expect(findPaperUnitDir(ROOT, '/ws/papers/1706.03762/figures/fig-1.png', entries))
      .toBe('/ws/papers/1706.03762')
  })

  it('returns null outside the workspace and without paper.json', () => {
    expect(findPaperUnitDir(ROOT, '/other/x.md', {})).toBeNull()
    expect(findPaperUnitDir(ROOT, '/ws/notes/a.md', { '/ws/notes': [file('a.md')] })).toBeNull()
    expect(findPaperUnitDir(ROOT, null, {})).toBeNull()
  })

  it('does not match directories without the marker even if named like a unit', () => {
    const entries: Record<string, WorkspaceEntry[]> = {
      '/ws/papers/1706.03762': [file('NOTES.md')]
    }
    expect(findPaperUnitDir(ROOT, '/ws/papers/1706.03762/NOTES.md', entries)).toBeNull()
  })
})

describe('paperUnitDirFromKnownUnits', () => {
  it('matches the longest known unit dir', () => {
    const known = ['papers/1706.03762', 'papers/1706.03762/nested']
    expect(paperUnitDirFromKnownUnits(ROOT, '/ws/papers/1706.03762/nested/x.md', known))
      .toBe('/ws/papers/1706.03762/nested')
  })

  it('accepts absolute unit dirs and rejects prefix lookalikes', () => {
    expect(paperUnitDirFromKnownUnits(ROOT, '/ws/papers/1706.03762/paper.md', ['/ws/papers/1706.03762']))
      .toBe('/ws/papers/1706.03762')
    expect(paperUnitDirFromKnownUnits(ROOT, '/ws/papers/1706.03762x/y.md', ['papers/1706.03762']))
      .toBeNull()
    expect(paperUnitDirFromKnownUnits(ROOT, '/elsewhere/x.md', ['papers/1706.03762'])).toBeNull()
  })
})

describe('paper unit path helpers', () => {
  it('derives slug, workspace-relative dir, and board slug', () => {
    expect(paperUnitSlugFromDir('/ws/papers/1706.03762/')).toBe('1706.03762')
    expect(paperUnitDirForFile('/ws/papers/1706.03762', ROOT)).toBe('papers/1706.03762')
    expect(paperBoardSlug('1706.03762')).toBe('17060376')
    expect(paperBoardSlug('cs.CL/0101001-long')).toBe('csCL0101')
    expect(paperBoardSlug('论文.解读')).toBe('paper')
  })
})

describe('nextInterpretationFileName', () => {
  it('picks the first free numbered name', () => {
    expect(nextInterpretationFileName('1706.03762', [])).toBe('1706.03762-解读.md')
    expect(nextInterpretationFileName('1706.03762', ['1706.03762-解读.md']))
      .toBe('1706.03762-解读-2.md')
    expect(nextInterpretationFileName('1706.03762', ['1706.03762-解读.md', '1706.03762-解读-2.md']))
      .toBe('1706.03762-解读-3.md')
  })
})
