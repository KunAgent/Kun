import { describe, expect, it } from 'vitest'
import { buildMemoryMarkdownExport } from '@shared/memory-import-export'
import {
  filterDuplicateMemoryImports,
  prepareMemoryImport
} from './settings-section-memory-import'

describe('prepareMemoryImport', () => {
  it('maps portable V2 records without carrying identity or audit timestamps', () => {
    const markdown = buildMemoryMarkdownExport({
      exportedAt: '2026-07-03T00:00:00.000Z',
      records: [{
        id: 'mem_original',
        content: 'Portable project memory',
        scope: 'project',
        workspace: 'D:/workspace-a',
        project: 'D:/workspace-a/project-a',
        tags: ['portable'],
        confidence: 0.7,
        type: 'decision',
        authority: 'reference',
        importance: 0.9,
        observedAt: '2026-06-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
        sources: [{ id: 'source_1', kind: 'user', trust: 'explicit-user' }],
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
        disabledAt: '2026-06-04T00:00:00.000Z'
      }]
    })

    const prepared = prepareMemoryImport(markdown, 'user', '')
    expect(prepared.kind).toBe('portable')
    expect(prepared.candidates[0]?.input).toEqual({
      content: 'Portable project memory',
      scope: 'project',
      workspace: 'D:/workspace-a',
      project: 'D:/workspace-a/project-a',
      tags: ['portable'],
      confidence: 0.7,
      type: 'decision',
      importance: 0.9,
      observedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      sources: [{ id: 'source_1', kind: 'user', trust: 'explicit-user' }],
      disabled: true
    })
    expect(prepared.candidates[0]?.input).not.toHaveProperty('id')
    expect(prepared.candidates[0]?.input).not.toHaveProperty('createdAt')
    expect(prepared.candidates[0]?.input).not.toHaveProperty('updatedAt')
  })

  it('keeps legacy profile scope selection and rejects invalid portable data', () => {
    const profile = prepareMemoryImport('偏好\n[2026-07-01] - Prefer concise answers', 'workspace', 'D:/workspace-a')
    expect(profile.kind).toBe('profile')
    expect(profile.candidates[0]?.input).toMatchObject({
      scope: 'workspace',
      targetPath: 'D:/workspace-a',
      type: 'preference'
    })
    expect(prepareMemoryImport('```kun-memory-v2\n{}\n```', 'user', '')).toMatchObject({
      kind: 'invalid-portable',
      candidates: []
    })
  })
})

describe('filterDuplicateMemoryImports', () => {
  it('skips existing and repeated records by content, scope, and normalized target', () => {
    const candidates = prepareMemoryImport(
      '偏好\n[2026-07-01] - Prefer concise answers\n[2026-07-01] - Prefer concise answers',
      'workspace',
      'D:/workspace-a'
    ).candidates
    const result = filterDuplicateMemoryImports({
      candidates,
      existingRecords: [{
        id: 'mem_existing',
        content: '[2026-07-01] 偏好: Prefer concise answers',
        scope: 'workspace',
        workspace: 'D:/workspace-a',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      }],
      expandPath: (path) => path
    })

    expect(result).toEqual({ candidates: [], skipped: 2 })
  })
})
