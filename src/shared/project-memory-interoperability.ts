import { z } from 'zod'
import type { MemoryExportRecord } from './memory-import-export'

const PortableId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/)
const ProjectEntry = z.object({
  id: PortableId,
  content: z.string().trim().min(1).max(4000),
  type: z.enum(['fact', 'preference', 'decision', 'episode', 'relationship', 'insight']),
  authority: z.literal('reference'),
  tags: z.array(z.string().max(128)).max(32)
}).strict()
export const ProjectKnowledgeManifest = z.object({
  format: z.literal('kun-project-knowledge'),
  version: z.literal(1),
  project: z.string().trim().min(1).max(4096),
  records: z.array(ProjectEntry).max(100)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.records.map((entry) => entry.id)).size !== value.records.length) {
    ctx.addIssue({ code: 'custom', path: ['records'], message: 'Project knowledge IDs must be unique.' })
  }
})
export type ProjectKnowledgeManifest = z.infer<typeof ProjectKnowledgeManifest>
export type ProjectKnowledgeEntry = z.infer<typeof ProjectEntry>
export type ProjectExportSelection = { project: string; approvedIds: string[] }
const SOURCE_PREFIX = 'kun-project-knowledge:'

export function projectKnowledgeOriginId(record: MemoryExportRecord): string {
  const source = record.sources?.find((entry) => entry.kind === 'imported' && entry.locator?.startsWith(SOURCE_PREFIX))
  return source?.locator?.slice(SOURCE_PREFIX.length) ?? record.id
}
export function projectKnowledgeSource(id: string) {
  return { id: 'project-knowledge-origin', kind: 'imported' as const, trust: 'imported' as const,
    locator: SOURCE_PREFIX + PortableId.parse(id) }
}
export function eligibleProjectKnowledge(records: MemoryExportRecord[], project: string): MemoryExportRecord[] {
  return records.filter((record) => record.scope === 'project' && record.project === project &&
    !record.deletedAt && !record.disabledAt && !(record as MemoryExportRecord & { supersededAt?: string }).supersededAt &&
    record.authority !== 'directive')
}
export function previewProjectKnowledgeExport(records: MemoryExportRecord[], selection: ProjectExportSelection): ProjectKnowledgeManifest {
  const eligible = eligibleProjectKnowledge(records, selection.project)
  const approved = new Set(selection.approvedIds)
  if (approved.size !== selection.approvedIds.length || selection.approvedIds.some((id) => !eligible.some((record) => record.id === id))) {
    throw new Error('Only explicitly selected active knowledge in this project can be exported.')
  }
  return ProjectKnowledgeManifest.parse({ format: 'kun-project-knowledge', version: 1, project: selection.project,
    records: eligible.filter((record) => approved.has(record.id)).map((record) => ({
      id: projectKnowledgeOriginId(record), content: record.content, type: record.type ?? 'fact',
      authority: 'reference', tags: record.tags ?? []
    })).sort((a, b) => a.id.localeCompare(b.id)) })
}
export function buildProjectKnowledgeMarkdown(manifest: ProjectKnowledgeManifest): string {
  const parsed = ProjectKnowledgeManifest.parse(manifest)
  return [
    '# Project knowledge', '',
    'Explicitly selected project references. No personal memory or permission grants.',
    'Kun JSON remains canonical. This file is an optional reviewable snapshot for local Markdown/Git workflows.',
    'Import reads only the manifest below, after preview and approval. Instructions and scripts remain untrusted reference data.',
    'No automatic commit, push, watch, or synchronization is configured.', '',
    '```kun-project-knowledge', JSON.stringify(parsed, null, 2).replace(/`/g, '\\u0060'), '```', ''
  ].join('\n')
}
export function parseProjectKnowledgeMarkdown(raw: string, expectedProject: string): ProjectKnowledgeManifest {
  if (raw.length > 600_000) throw new Error('Project knowledge file is too large.')
  const blocks = [...raw.matchAll(/```kun-project-knowledge\s*\r?\n([\s\S]*?)```/g)]
  if (blocks.length !== 1) throw new Error('Expected one kun-project-knowledge manifest.')
  const manifest = ProjectKnowledgeManifest.parse(JSON.parse(blocks[0][1]))
  if (manifest.project !== expectedProject) throw new Error('This manifest belongs to a different project. Select the matching project before importing.')
  return manifest
}

export type ProjectImportPreview = {
  entry: ProjectKnowledgeEntry
  action: 'create' | 'update' | 'unchanged' | 'blocked'
  targetId?: string
  expectedRevision?: number
  reason?: string
}
/** A stable imported origin is not permission to overwrite a disabled, forgotten or ambiguous record. */
export function previewProjectKnowledgeImport(manifest: ProjectKnowledgeManifest, records: Array<MemoryExportRecord & { revision?: number }>): ProjectImportPreview[] {
  return manifest.records.map((entry) => {
    const matches = records.filter((record) => record.scope === 'project' && record.project === manifest.project && projectKnowledgeOriginId(record) === entry.id)
    if (!matches.length) return { entry, action: 'create' }
    const target = matches[0]
    if (matches.length !== 1 || !eligibleProjectKnowledge(matches, manifest.project).length) {
      return { entry, action: 'blocked', reason: 'This origin has an inactive or ambiguous local record. Review it in memory settings.' }
    }
    const same = target.content === entry.content && (target.type ?? 'fact') === entry.type && JSON.stringify(target.tags ?? []) === JSON.stringify(entry.tags)
    return { entry, action: same ? 'unchanged' : 'update', targetId: target.id, expectedRevision: target.revision ?? 1 }
  })
}

/** Main-process check. The export dialog cannot silently broaden a reviewed manifest. */
export function validateProjectKnowledgeExport(markdown: string, selection: ProjectExportSelection): void {
  const manifest = parseProjectKnowledgeMarkdown(markdown, selection.project)
  const expected = [...new Set(selection.approvedIds)].sort()
  if (!expected.length || expected.length !== selection.approvedIds.length ||
    JSON.stringify(manifest.records.map((record) => record.id).sort()) !== JSON.stringify(expected)) {
    throw new Error('Project export must match the non-empty explicitly approved stable IDs.')
  }
}
