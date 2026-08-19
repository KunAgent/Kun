import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildKnowledgeIndex, scanKnowledgeSources } from './knowledge-indexer.js'
import { KNOWLEDGE_INDEX_SCHEMA_VERSION } from './knowledge-types.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

describe('vectorless knowledge index', () => {
  it('builds structural Markdown/text nodes and document reference edges deterministically', async () => {
    const root = await tempRoot('kun-kb-index-')
    await mkdir(join(root, 'guides'))
    await writeFile(join(root, 'README.md'), '# Overview\n\nSee [Setup](guides/setup.md).\n')
    await writeFile(join(root, 'guides', 'setup.md'), '# Setup\n\n## Install\n\nRun the installer.\n')
    await writeFile(join(root, 'notes.txt'), 'First paragraph.\n\nSecond paragraph.\n')

    const scan = await scanKnowledgeSources(root)
    const first = await buildKnowledgeIndex(scan, () => '2026-08-12T00:00:00.000Z')
    const second = await buildKnowledgeIndex(scan, () => '2026-08-12T00:00:00.000Z')

    expect(scan.files.map((file) => file.relativePath)).toEqual([
      'guides/setup.md', 'notes.txt', 'README.md'
    ])
    expect(first.nodes).toEqual(second.nodes)
    expect(Object.values(first.nodes)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'section', title: 'Setup' }),
      expect.objectContaining({ kind: 'section', title: 'Install' }),
      expect.objectContaining({ kind: 'range', title: 'Paragraph 2' })
    ]))
    expect(first.references).toHaveLength(1)
    expect(first.references[0]).toMatchObject({ label: 'Setup' })
  })

  it('skips symlinks so sources cannot escape the mounted root', async () => {
    const root = await tempRoot('kun-kb-safe-')
    const outside = await tempRoot('kun-kb-outside-')
    await writeFile(join(outside, 'secret.md'), '# Secret\n')
    await symlink(join(outside, 'secret.md'), join(root, 'linked.md'))
    await writeFile(join(root, 'safe.md'), '# Safe\n')

    const scan = await scanKnowledgeSources(root)
    expect(scan.files.map((file) => file.relativePath)).toEqual(['safe.md'])
  })

  it('scans all six Office formats, skips lock files, and builds precise Office nodes', async () => {
    const root = await tempRoot('kun-kb-office-index-')
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
    const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1])
    for (const extension of ['docx', 'xlsx', 'pptx']) await writeFile(join(root, `modern.${extension}`), zipHeader)
    for (const extension of ['doc', 'xls', 'ppt']) await writeFile(join(root, `legacy.${extension}`), oleHeader)
    await writeFile(join(root, '~$draft.docx'), zipHeader)
    await writeFile(join(root, 'misleading.docx'), oleHeader)
    await writeFile(join(root, 'empty.docx'), '')
    await writeFile(join(root, 'oversized.docx'), zipHeader)
    await truncate(join(root, 'oversized.docx'), 10 * 1024 * 1024 + 1)

    const scan = await scanKnowledgeSources(root)
    expect(scan.files.map((file) => file.relativePath)).toEqual([
      'legacy.doc', 'legacy.ppt', 'legacy.xls', 'modern.docx', 'modern.pptx', 'modern.xlsx'
    ])
    expect(scan.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('misleading.docx'),
      expect.stringContaining('empty.docx'),
      expect.stringContaining('oversized.docx')
    ]))
    const index = await buildKnowledgeIndex(scan, undefined, {
      officeArtifacts: {
        loadOrExtract: async (file) => {
          const format = extname(file.relativePath).slice(1) as 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx'
          const presentation = format === 'ppt' || format === 'pptx'
          const spreadsheet = format === 'xls' || format === 'xlsx'
          return {
            artifactKey: `${'a'.repeat(64)}.${format}.office-v1.json`,
            reused: false,
            artifact: {
              version: 1,
              extractorVersion: 'office-v1',
              sourceSha256: 'a'.repeat(64),
              format,
              truncated: false,
              diagnostics: [],
              chunks: [{
                key: 'content:1',
                kind: presentation ? 'slide' : spreadsheet ? 'cell-range' : 'range',
                title: presentation ? 'Slide 1' : spreadsheet ? 'A1:B2' : 'Paragraphs 1-2',
                summary: 'Office evidence',
                location: presentation
                  ? { kind: 'presentation', slideStart: 1, slideEnd: 1 }
                  : spreadsheet
                    ? { kind: 'spreadsheet', sheetName: 'Sheet1', range: 'A1:B2' }
                    : { kind: 'word', paragraphStart: 1, paragraphEnd: 2 },
                text: 'Office evidence'
              }]
            }
          }
        }
      }
    })

    expect(index.version).toBe(KNOWLEDGE_INDEX_SCHEMA_VERSION)
    expect(index.documents).toHaveLength(6)
    expect(index.documents.every((document) => document.available && document.artifactKey)).toBe(true)
    expect(Object.values(index.nodes)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'slide', location: { kind: 'presentation', slideStart: 1, slideEnd: 1 } }),
      expect.objectContaining({ kind: 'cell-range', location: { kind: 'spreadsheet', sheetName: 'Sheet1', range: 'A1:B2' } }),
      expect.objectContaining({ kind: 'range', location: { kind: 'word', paragraphStart: 1, paragraphEnd: 2 } })
    ]))
  })
})

describe('empty markdown sources', () => {
  it('indexes an empty file as a document with no content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-empty-'))
    roots.push(root)
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', 'blank.md'), '')
    await writeFile(join(root, 'index.md'), '# Index\nlinks to [[notes/blank]]\n')

    const scan = await scanKnowledgeSources(root)
    const index = await buildKnowledgeIndex(scan)

    // An empty note is still a file in the vault: it has to appear as a node,
    // nested under its folder, or the graph silently loses it.
    const blank = Object.values(index.nodes).find((node) => node.title === 'blank.md')
    expect(blank?.kind).toBe('document')
    expect(blank?.relativePath).toBe('notes/blank.md')
    expect(blank?.childIds).toEqual([])

    // Its folder chain exists, so containment still renders.
    const folder = Object.values(index.nodes).find((node) => node.kind === 'directory')
    expect(folder?.childIds).toContain(blank?.id)

    // The document record says why there is nothing to read.
    const record = index.documents.find((item) => item.relativePath === 'notes/blank.md')
    expect(record?.available).toBe(false)
    expect(record?.error).toBe('Empty file')

    // And a link pointing at it still resolves.
    expect(index.references.some((reference) => reference.toId === blank?.id)).toBe(true)
    expect(index.diagnostics.join(' ')).not.toContain('Skipped empty source')
  })

  it('changes the fingerprint when a file becomes empty, forcing a rebuild', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-empty-fp-'))
    roots.push(root)
    const file = join(root, 'note.md')
    await writeFile(file, '# Note\n')
    const before = (await scanKnowledgeSources(root)).fingerprint
    await writeFile(file, '')
    const after = (await scanKnowledgeSources(root)).fingerprint
    expect(after).not.toBe(before)
  })
})
