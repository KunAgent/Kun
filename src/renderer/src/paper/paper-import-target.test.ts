import { describe, expect, it } from 'vitest'

import { importFolderLabel, normalizePaperFolderInput, paperImportParentDir } from './paper-import-target'

describe('paper import target', () => {
  it('normalizes folder input to a relative slash path', () => {
    expect(normalizePaperFolderInput('  ')).toBe('')
    expect(normalizePaperFolderInput('/nlp\\agents/ ')).toBe('nlp/agents')
    expect(normalizePaperFolderInput(' week 1 / reading ')).toBe('week 1/reading')
  })

  it('rejects dot segments, reserved characters and deep paths', () => {
    for (const bad of ['..', 'a/../b', '.hidden', 'a//b', 'a:b', 'a/b/c/d', 'figures', 'x/assets']) {
      expect(normalizePaperFolderInput(bad)).toBeNull()
    }
  })

  it('joins the papers dir with the folder', () => {
    expect(paperImportParentDir('papers', '')).toBe('papers')
    expect(paperImportParentDir('lib/papers/', 'nlp/agents')).toBe('lib/papers/nlp/agents')
    expect(paperImportParentDir('', 'x')).toBe('papers/x')
  })

  it('labels a folder by its last segment', () => {
    expect(importFolderLabel('', 'Unfiled')).toBe('Unfiled')
    expect(importFolderLabel('nlp/agents', 'Unfiled')).toBe('agents')
  })
})
