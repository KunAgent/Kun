import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { afterEach, describe, expect, it } from 'vitest'
import * as yazl from 'yazl'
import { KnowledgeBaseMountsSchema } from '../contracts/threads.js'
import { createThreadRecord, normalizeKnowledgeBaseMounts } from '../domain/thread.js'
import { KnowledgeBaseError, KnowledgeBaseService } from './knowledge-base-service.js'
import { KnowledgeOfficeExtractorRegistry } from './knowledge-office-extractor.js'
import { buildKnowledgeLocalTools } from './knowledge-tools.js'
import {
  KNOWLEDGE_INDEX_SCHEMA_VERSION,
  type StoredKnowledgeIndex
} from './knowledge-types.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

describe('knowledge-base service and tools', () => {
  it('indexes, catalogs, navigates, reads cited evidence, and detects stale sources', async () => {
    const root = await tempRoot('kun-kb-service-')
    const dataDir = await tempRoot('kun-kb-data-')
    await writeFile(join(root, 'guide.md'), '# Setup Guide\n\nInstall the local package.\n')
    const mount = { id: 'kb_guide', root, name: 'Guide', source: 'write-workspace', access: 'read-only' } as const
    const thread = createThreadRecord({
      id: 'thr_kb', title: 'KB', workspace: await tempRoot('kun-code-'),
      model: 'test', knowledgeBases: [mount]
    })
    const service = new KnowledgeBaseService({
      dataDir,
      threadStore: { get: async (id) => id === thread.id ? thread : null },
      nowIso: () => '2026-08-12T00:00:00.000Z'
    })

    const catalog = await service.catalog(thread.id, 'setup')
    expect(catalog.mounts[0]).toMatchObject({ id: mount.id, status: { state: 'ready' } })
    expect(catalog.matches[0]?.node.title).toBe('Setup Guide')
    const rootView = await service.browse(thread.id, mount.id)
    const document = rootView.children.find((node) => node.kind === 'document')
    expect(document).toBeTruthy()
    const documentView = await service.browse(thread.id, mount.id, document!.id)
    const section = documentView.children.find((node) => node.title === 'Setup Guide')
    const evidence = await service.read(thread.id, mount.id, [section!.id])
    expect(evidence.notice).toContain('untrusted')
    expect(evidence.evidence[0]).toMatchObject({
      relativePath: 'guide.md',
      location: { kind: 'text', lineStart: 1 }
    })
    expect(evidence.evidence[0]?.text).toContain('Install the local package')

    await writeFile(join(root, 'guide.md'), '# Setup Guide\n\nInstall the updated local package.\n')
    const status = await service.listForThread(thread.id)
    expect(status.statuses[0]?.state).toBe('stale')
    await service.reindex(thread.id, mount.id)
  })

  it('refreshes Markdown, text, and PDF evidence changed inside the index cache window', async () => {
    const root = await tempRoot('kun-kb-fresh-read-')
    const dataDir = await tempRoot('kun-kb-fresh-data-')
    await writeFile(join(root, 'guide.md'), '# Guide\n\nOriginal Markdown evidence.\n')
    await writeFile(join(root, 'notes.txt'), 'Original text evidence.\n')
    await writeFile(join(root, 'brief.pdf'), createSimpleTextPdf('Original PDF evidence.'))
    const mount = {
      id: 'kb_fresh', root, name: 'Fresh sources',
      source: 'write-workspace', access: 'read-only'
    } as const
    const thread = createThreadRecord({
      id: 'thr_fresh', title: 'Fresh reads', workspace: await tempRoot('kun-fresh-code-'),
      model: 'test', knowledgeBases: [mount]
    })
    const service = new KnowledgeBaseService({
      dataDir,
      threadStore: { get: async () => thread }
    })

    await service.catalog(thread.id)
    const rootView = await service.browse(thread.id, mount.id)
    const nodeIds: string[] = []
    for (const relativePath of ['guide.md', 'notes.txt', 'brief.pdf']) {
      const document = rootView.children.find((node) => node.relativePath === relativePath)
      expect(document, relativePath).toBeTruthy()
      const documentView = await service.browse(thread.id, mount.id, document!.id)
      expect(documentView.children[0], relativePath).toBeTruthy()
      nodeIds.push(documentView.children[0]!.id)
    }

    await writeFile(join(root, 'guide.md'), '# Guide\n\nUpdated Markdown evidence is current.\n')
    await writeFile(join(root, 'notes.txt'), 'Updated text evidence is current.\n')
    await writeFile(join(root, 'brief.pdf'), createSimpleTextPdf('Updated PDF evidence is current.'))

    const result = await service.read(thread.id, mount.id, nodeIds)
    expect(result.evidence.map((item) => item.text)).toEqual([
      expect.stringContaining('Updated Markdown evidence is current.'),
      expect.stringContaining('Updated text evidence is current.'),
      expect.stringContaining('Updated PDF evidence is current.')
    ])
    expect(result.evidence.map((item) => item.text).join('\n')).not.toContain('Original')
  }, 15_000)

  it('authorizes only mounted ids, exposes no path arguments, and advertises only with mounts', async () => {
    const root = await tempRoot('kun-kb-tools-')
    const dataDir = await tempRoot('kun-kb-tool-data-')
    const thread = createThreadRecord({
      id: 'thr_tools', title: 'Tools', workspace: await tempRoot('kun-code-'), model: 'test',
      knowledgeBases: [{ id: 'kb_docs', root, name: 'Docs', source: 'write-workspace', access: 'read-only' }]
    })
    const service = new KnowledgeBaseService({
      dataDir,
      threadStore: { get: async () => thread }
    })
    await expect(service.browse(thread.id, 'kb_unknown')).rejects.toMatchObject({
      code: 'not_found'
    } satisfies Partial<KnowledgeBaseError>)
    const tools = buildKnowledgeLocalTools(service)
    expect(tools.map((tool) => tool.name)).toEqual([
      'knowledge_catalog', 'knowledge_browse', 'knowledge_read'
    ])
    expect(JSON.stringify(tools.map((tool) => tool.inputSchema))).not.toMatch(/root|path/i)
    const context = {
      threadId: thread.id, turnId: 'turn_1', workspace: thread.workspace,
      knowledgeBases: thread.knowledgeBases,
      approvalPolicy: 'auto', sandboxMode: 'workspace-write'
    } as Parameters<NonNullable<(typeof tools)[number]['shouldAdvertise']>>[0]
    expect(tools.every((tool) => tool.sideEffect === 'read-only')).toBe(true)
    expect(tools.every((tool) => tool.shouldAdvertise?.(context) === true)).toBe(true)
    expect(tools.every((tool) => tool.shouldAdvertise?.({ ...context, knowledgeBases: [] }) === false)).toBe(true)
  })

  it('reuses SHA-keyed Office artifacts, reports formats, and refuses stale evidence', async () => {
    const root = await tempRoot('kun-kb-office-service-')
    const dataDir = await tempRoot('kun-kb-office-data-')
    const path = join(root, 'report.docx')
    await writeMinimalDocx(path, 'first')
    let extractedText = '# Summary\n\nOriginal Office evidence.'
    let calls = 0
    const officeExtractor = new KnowledgeOfficeExtractorRegistry({
      officeCli: {
        run: async () => {
          calls += 1
          return { stdout: extractedText, stderr: '', exitCode: 0 }
        }
      }
    })
    const mount = { id: 'kb_office', root, name: 'Office', source: 'write-workspace', access: 'read-only' } as const
    const thread = createThreadRecord({
      id: 'thr_office_kb', title: 'Office KB', workspace: await tempRoot('kun-office-code-'),
      model: 'test', knowledgeBases: [mount]
    })
    const service = new KnowledgeBaseService({
      dataDir,
      threadStore: { get: async () => thread },
      officeExtractor
    })

    const firstCatalog = await service.catalog(thread.id, 'Original')
    expect(firstCatalog.mounts[0]?.status).toMatchObject({
      state: 'ready',
      availableDocumentCount: 1,
      unavailableDocumentCount: 0,
      formatCounts: { docx: 1 }
    })
    const document = (await service.browse(thread.id, mount.id)).children.find((node) => node.kind === 'document')!
    const section = (await service.browse(thread.id, mount.id, document.id)).children[0]!
    const range = (await service.browse(thread.id, mount.id, section.id)).children[0]!
    const firstEvidence = await service.read(thread.id, mount.id, [range.id])
    expect(firstEvidence.evidence[0]).toMatchObject({
      relativePath: 'report.docx',
      format: 'docx',
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      location: { kind: 'word', paragraphStart: 2, paragraphEnd: 2 },
      text: 'Original Office evidence.'
    })

    await service.reindex(thread.id, mount.id)
    expect(calls).toBe(1)
    extractedText = '# Summary\n\nUpdated Office evidence.'
    await writeMinimalDocx(path, 'other')
    const key = createHash('sha256').update(root).digest('hex')
    const internals = service as unknown as {
      indexCache: Map<string, { index: StoredKnowledgeIndex }>
      inFlight: Map<string, Promise<StoredKnowledgeIndex>>
    }
    const cachedIndex = internals.indexCache.get(key)?.index
    expect(cachedIndex).toBeTruthy()
    internals.inFlight.set(key, Promise.resolve(cachedIndex!))
    try {
      await expect(service.read(thread.id, mount.id, [range.id])).rejects.toMatchObject({
        code: 'unavailable'
      } satisfies Partial<KnowledgeBaseError>)
    } finally {
      internals.inFlight.delete(key)
    }
    await service.reindex(thread.id, mount.id)
    const updatedEvidence = await service.read(thread.id, mount.id, [range.id])
    expect(calls).toBe(2)
    expect(updatedEvidence.evidence[0]?.text).toBe('Updated Office evidence.')

    const artifactMounts = await readdir(join(dataDir, 'knowledge-artifacts'))
    const artifactFiles = await readdir(join(dataDir, 'knowledge-artifacts', artifactMounts[0]!))
    expect(artifactFiles).toHaveLength(1)
  })

  it('treats schema-v1 indexes as rebuildable derived cache', async () => {
    const root = await tempRoot('kun-kb-v1-root-')
    const dataDir = await tempRoot('kun-kb-v1-data-')
    await writeFile(join(root, 'guide.md'), '# Current source\n')
    const key = createHash('sha256').update(root).digest('hex')
    const indexDirectory = join(dataDir, 'knowledge-indexes')
    await mkdir(indexDirectory)
    await writeFile(join(indexDirectory, `${key}.json`), JSON.stringify({
      version: 1,
      root,
      fingerprint: 'old',
      builtAt: '2020-01-01T00:00:00.000Z',
      rootNodeId: 'old-root',
      documents: [],
      nodes: {},
      references: [],
      diagnostics: []
    }))
    const mount = { id: 'kb_v1', root, name: 'V1', source: 'write-workspace', access: 'read-only' } as const
    const thread = createThreadRecord({
      id: 'thr_v1', title: 'V1', workspace: await tempRoot('kun-kb-v1-code-'), model: 'test', knowledgeBases: [mount]
    })
    const service = new KnowledgeBaseService({ dataDir, threadStore: { get: async () => thread } })
    const catalog = await service.catalog(thread.id, 'Current')
    expect(catalog.matches.some((match) => match.node.title === 'Current source')).toBe(true)
    const stored = JSON.parse(await readFile(join(indexDirectory, `${key}.json`), 'utf8')) as { version: number }
    expect(stored.version).toBe(KNOWLEDGE_INDEX_SCHEMA_VERSION)
  })

  it('keeps usable sources ready when an optional Office extractor is unavailable', async () => {
    const root = await tempRoot('kun-kb-partial-root-')
    const dataDir = await tempRoot('kun-kb-partial-data-')
    await writeFile(join(root, 'notes.md'), '# Usable notes\n')
    await writeMinimalDocx(join(root, 'requires-officecli.docx'), 'content')
    const mount = { id: 'kb_partial', root, name: 'Partial', source: 'write-workspace', access: 'read-only' } as const
    const thread = createThreadRecord({
      id: 'thr_partial', title: 'Partial', workspace: await tempRoot('kun-kb-partial-code-'), model: 'test', knowledgeBases: [mount]
    })
    const service = new KnowledgeBaseService({ dataDir, threadStore: { get: async () => thread } })
    const catalog = await service.catalog(thread.id, 'Usable')
    expect(catalog.matches.some((match) => match.node.title === 'Usable notes')).toBe(true)
    expect(catalog.mounts[0]?.status).toMatchObject({
      state: 'ready',
      availableDocumentCount: 1,
      unavailableDocumentCount: 1,
      formatCounts: { markdown: 1, docx: 1 },
      diagnostics: expect.arrayContaining([expect.stringContaining('OfficeCLI is required')])
    })
  })
})

describe('knowledge scan budget', () => {
  function folderIndexService(dataDir: string): KnowledgeBaseService {
    return new KnowledgeBaseService({
      dataDir,
      threadStore: { get: async () => null },
      nowIso: () => '2026-08-12T00:00:00.000Z'
    })
  }

  it('refuses a rebuild that exceeds the budget, serves the stored index, and charges later rebuilds', async () => {
    const root = await tempRoot('kun-kb-budget-')
    const dataDir = await tempRoot('kun-kb-budget-data-')
    await writeFile(join(root, 'a.md'), '# A\n\nAlpha note body.\n')
    const service = folderIndexService(dataDir)

    const first = await service.readyFolderIndex(root, 'mount-a', { verifyFreshness: true })
    expect(first.state).toBe('ready')
    expect(first.index?.documents).toHaveLength(1)

    // The tree changed, so a rebuild is due — but the request has no allowance
    // left. The last built index is served instead and nothing is scheduled.
    await writeFile(join(root, 'b.md'), '# B\n\nBeta note body.\n')
    const refused = await service.readyFolderIndex(root, 'mount-a', {
      verifyFreshness: true,
      budget: {
        remainingFiles: 0,
        remainingBytes: 0,
        remainingDirectories: 0,
        remainingEntries: 0,
        remainingMetadataOps: 0
      }
    })
    expect(refused.budgetExhausted).toBe(true)
    expect(refused.state).toBe('stale')
    expect(refused.index?.documents.map((document) => document.relativePath)).toEqual(['a.md'])

    // A request with allowance rebuilds and pays for exactly what it scanned.
    const allowance = {
      remainingFiles: 10,
      remainingBytes: 1024 * 1024,
      remainingDirectories: 10,
      remainingEntries: 100,
      remainingMetadataOps: 100
    }
    const rebuilt = await service.readyFolderIndex(root, 'mount-a', {
      verifyFreshness: true,
      budget: allowance
    })
    expect(rebuilt.budgetExhausted).toBeUndefined()
    expect(rebuilt.index?.documents).toHaveLength(2)
    expect(allowance.remainingFiles).toBe(8)
    expect(allowance.remainingBytes).toBeLessThan(1024 * 1024)
    expect(allowance.remainingDirectories).toBeLessThan(10)
    expect(allowance.remainingMetadataOps).toBeLessThan(100)
  })

  it('charges the walk but no bytes when the fingerprint has not moved', async () => {
    const root = await tempRoot('kun-kb-budget-fresh-')
    const dataDir = await tempRoot('kun-kb-budget-fresh-data-')
    await writeFile(join(root, 'a.md'), '# A\n\nAlpha note body.\n')
    const service = folderIndexService(dataDir)
    await service.readyFolderIndex(root, 'mount-a', { verifyFreshness: true })

    const allowance = {
      remainingFiles: 5,
      remainingBytes: 4_096,
      remainingDirectories: 5,
      remainingEntries: 50,
      remainingMetadataOps: 50
    }
    const unchanged = await service.readyFolderIndex(root, 'mount-a', {
      verifyFreshness: true,
      budget: allowance
    })
    expect(unchanged.state).toBe('ready')
    expect(unchanged.index?.documents).toHaveLength(1)
    // The stat pass is real I/O, so the traversal fields are charged even when
    // nothing gets rebuilt — that bounds a many-root request's metadata scans.
    expect(allowance.remainingFiles).toBe(4)
    expect(allowance.remainingDirectories).toBe(4)
    // Bytes bound content reads, and a fingerprint match reads no content.
    expect(allowance.remainingBytes).toBe(4_096)
  })

  it('does not begin scanning a root once the walk allowance is spent', async () => {
    const root = await tempRoot('kun-kb-budget-spent-')
    const dataDir = await tempRoot('kun-kb-budget-spent-data-')
    await writeFile(join(root, 'a.md'), '# A\n\nAlpha note body.\n')
    const service = folderIndexService(dataDir)

    const spent = await service.readyFolderIndex(root, 'mount-a', {
      verifyFreshness: true,
      budget: {
        remainingFiles: 5,
        remainingBytes: 4_096,
        remainingDirectories: 0,
        remainingEntries: 50,
        remainingMetadataOps: 50
      }
    })
    // Never indexed and never scanned: there is no stored index to serve.
    expect(spent.budgetExhausted).toBe(true)
    expect(spent.state).toBe('pending')
    expect(spent.index).toBeNull()
  })
})

describe('knowledge-base mount contracts', () => {
  it('rejects duplicate and overlapping roots while keeping mounts read-only', () => {
    expect(() => KnowledgeBaseMountsSchema.parse([
      { id: 'same', root: '/tmp/a', name: 'A', source: 'write-workspace', access: 'read-only' },
      { id: 'same', root: '/tmp/b', name: 'B', source: 'write-workspace', access: 'read-only' }
    ])).toThrow()
    expect(() => normalizeKnowledgeBaseMounts([
      { id: 'a', root: '/tmp/docs', name: 'A', source: 'write-workspace', access: 'read-only' },
      { id: 'b', root: '/tmp/docs/nested', name: 'B', source: 'write-workspace', access: 'read-only' }
    ], '/tmp/code')).toThrow(/overlap/i)
  })
})

async function writeMinimalDocx(path: string, marker: string): Promise<void> {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(
    '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ), '[Content_Types].xml')
  zip.addBuffer(Buffer.from(marker), 'word/document.xml', { compress: false })
  const output = createWriteStream(path)
  zip.outputStream.pipe(output)
  zip.end()
  await finished(output)
}

function createSimpleTextPdf(text: string): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    [
      '3 0 obj',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]',
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      'endobj\n'
    ].join('\n'),
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}
