import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { LibraryArtifact } from './artifact-types'
import { revisionPrompt, sourceThreadFor } from './artifact-actions'
import { countByKind, filterArtifacts, formatArtifactSize, formatArtifactTime, projectOptions } from './artifact-view-model'

function artifact(overrides: Partial<LibraryArtifact>): LibraryArtifact {
  return {
    id: overrides.id ?? `id-${overrides.title}`,
    kind: 'doc',
    title: 'Doc',
    workspaceRoot: '/work/a',
    projectName: 'a',
    path: 'doc.docx',
    ext: '.docx',
    updatedAt: 0,
    ...overrides
  }
}

const items = [
  artifact({ title: 'Beta deck', kind: 'slides', updatedAt: 30, workspaceRoot: '/work/b', projectName: 'b' }),
  artifact({ title: 'Alpha report', kind: 'doc', updatedAt: 10 }),
  artifact({ title: 'Footer design', kind: 'design', updatedAt: 20, path: '.kun-design/doc_1', designDocumentId: 'doc_1' })
]

describe('artifact view model', () => {
  it('filters by kind, project and query and sorts by time or name', () => {
    expect(filterArtifacts(items, { kind: 'all', project: '', query: '', sort: 'recent' }).map((item) => item.title))
      .toEqual(['Beta deck', 'Footer design', 'Alpha report'])
    expect(filterArtifacts(items, { kind: 'all', project: '', query: '', sort: 'name' }).map((item) => item.title))
      .toEqual(['Alpha report', 'Beta deck', 'Footer design'])
    expect(filterArtifacts(items, { kind: 'design', project: '', query: '', sort: 'recent' })).toHaveLength(1)
    expect(filterArtifacts(items, { kind: 'all', project: '/work/b', query: '', sort: 'recent' })).toHaveLength(1)
    expect(filterArtifacts(items, { kind: 'all', project: '', query: 'kun-design', sort: 'recent' })).toHaveLength(1)
  })

  it('counts kinds and lists projects once', () => {
    expect(countByKind(items)).toMatchObject({ all: 3, slides: 1, doc: 1, design: 1, image: 0 })
    expect(projectOptions(items)).toEqual([{ root: '/work/a', name: 'a' }, { root: '/work/b', name: 'b' }])
  })

  it('formats sizes and recent times', () => {
    expect(formatArtifactSize(undefined)).toBe('')
    expect(formatArtifactSize(512)).toBe('512 B')
    expect(formatArtifactSize(2048)).toBe('2 KB')
    expect(formatArtifactSize(3 * 1024 * 1024)).toBe('3.0 MB')
    const now = Date.UTC(2026, 9, 20, 12)
    expect(formatArtifactTime(now - 5 * 60_000, 'en', now)).toBe('5 minutes ago')
    expect(formatArtifactTime(now - 2 * 86_400_000, 'en', now)).toBe('2 days ago')
    expect(formatArtifactTime(0, 'en', now)).toBe('')
  })

  it('finds the source conversation from the record or the design binding', () => {
    const threads = [
      { id: 't1', workspace: '/work/a', title: 'Design thread', designProfile: { documentTarget: { documentId: 'doc_1', boardArtifactId: 'b' } } },
      { id: 't2', workspace: '/work/a', title: 'Board thread' }
    ] as unknown as NormalizedThread[]
    expect(sourceThreadFor(items[2], threads)?.id).toBe('t1')
    expect(sourceThreadFor(artifact({ sourceThreadId: 't2' }), threads)?.id).toBe('t2')
    expect(sourceThreadFor(artifact({ sourceThreadId: 'missing' }), threads)).toBeNull()
    expect(sourceThreadFor({ ...items[2], workspaceRoot: '/elsewhere' }, threads)).toBeNull()
  })

  it('tells the agent which artifact to revise', () => {
    expect(revisionPrompt(items[1], ' Shorten section 2 ', 'page 2')).toBe(
      'Shorten section 2\n\nApply this to `doc.docx` in /work/a, focusing on page 2.'
    )
    expect(revisionPrompt(items[2], 'Bigger button')).toContain('the design draft "Footer design" (.kun-design/doc_1)')
  })
})
