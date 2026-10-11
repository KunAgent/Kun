import { describe, expect, it } from 'vitest'
import { buildProjectKnowledgeMarkdown, parseProjectKnowledgeMarkdown, previewProjectKnowledgeExport,
  previewProjectKnowledgeImport, projectKnowledgeSource, validateProjectKnowledgeExport } from './project-memory-interoperability'
import type { MemoryExportRecord } from './memory-import-export'

const project = '/repo/project'
const record: MemoryExportRecord = { id: 'stable-1', content: 'Run tests before review.', scope: 'project', project,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', type: 'fact', tags: [] }
const selection = { project, approvedIds: [record.id] }
describe('explicit project knowledge snapshots', () => {
  it('has a named empty preview and exports nothing by default', () => {
    const preview = previewProjectKnowledgeExport([record], { project, approvedIds: [] })
    expect(preview.records).toEqual([])
    expect(() => validateProjectKnowledgeExport(buildProjectKnowledgeMarkdown(preview), { project, approvedIds: [] })).toThrow('non-empty')
  })
  it('excludes personal, other-project, disabled and directive memories even if selected', () => {
    for (const extra of [{ scope: 'user' as const }, { project: '/other' }, { disabledAt: 'now' }, { authority: 'directive' as const }]) {
      expect(() => previewProjectKnowledgeExport([{ ...record, ...extra }], selection)).toThrow('explicitly selected')
    }
  })
  it('round trips stable IDs, preserves reference-only authority and escapes embedded fences', () => {
    const preview = previewProjectKnowledgeExport([{ ...record, content: '```sh\nmalicious-command\n```' }], selection)
    const markdown = buildProjectKnowledgeMarkdown(preview)
    expect(parseProjectKnowledgeMarkdown(markdown, project)).toEqual(preview)
    validateProjectKnowledgeExport(markdown, selection)
    expect(markdown).toContain('No automatic commit, push')
    expect(preview.records[0].authority).toBe('reference')
  })
  it('rejects mismatched projects, changed approval and malformed or duplicate manifests', () => {
    const preview = previewProjectKnowledgeExport([record], selection), markdown = buildProjectKnowledgeMarkdown(preview)
    expect(() => parseProjectKnowledgeMarkdown(markdown, '/other')).toThrow('different project')
    expect(() => validateProjectKnowledgeExport(markdown, { project, approvedIds: ['other'] })).toThrow('approved stable IDs')
    expect(() => parseProjectKnowledgeMarkdown(markdown + markdown, project)).toThrow('one')
    expect(() => buildProjectKnowledgeMarkdown({ ...preview, records: [...preview.records, ...preview.records] })).toThrow('unique')
    expect(() => parseProjectKnowledgeMarkdown(markdown.replace('"reference"', '"directive"'), project)).toThrow()
  })
  it('repeated import matches the stable origin and uses the current CAS revision', () => {
    const manifest = previewProjectKnowledgeExport([record], selection)
    expect(previewProjectKnowledgeImport(manifest, [])[0].action).toBe('create')
    const imported = { ...record, id: 'local-new-id', revision: 4, sources: [projectKnowledgeSource(record.id)] }
    expect(previewProjectKnowledgeImport(manifest, [imported])[0]).toMatchObject({ action: 'unchanged', targetId: imported.id, expectedRevision: 4 })
    const changed = { ...manifest, records: manifest.records.map((entry) => ({ ...entry, content: 'Updated project fact' })) }
    expect(previewProjectKnowledgeImport(changed, [imported])[0]).toMatchObject({ action: 'update', targetId: imported.id, expectedRevision: 4 })
    expect(previewProjectKnowledgeExport([imported], { project, approvedIds: [imported.id] }).records[0].id).toBe(record.id)
    expect(previewProjectKnowledgeImport(changed, [{ ...imported, deletedAt: 'now' }])[0].action).toBe('blocked')
    expect(previewProjectKnowledgeImport(changed, [imported, { ...imported, id: 'duplicate' }])[0].action).toBe('blocked')
  })
})
