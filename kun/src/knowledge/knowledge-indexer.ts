import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { KnowledgeOfficeArtifactLoader } from './knowledge-office-artifact-store.js'
import {
  isTemporaryOfficeSource,
  KNOWLEDGE_OFFICE_EXTENSIONS,
  MAX_KNOWLEDGE_OFFICE_FILE_BYTES,
  officeKnowledgeFormat,
  validateOfficeSourceHeader
} from './knowledge-office-source.js'
import {
  KNOWLEDGE_INDEX_SCHEMA_VERSION,
  type KnowledgeDocument,
  type KnowledgeNode,
  type KnowledgeOfficeArtifact,
  type KnowledgeExternalReferenceEdge,
  type KnowledgeReferenceEdge,
  type KnowledgeSourceFile,
  type KnowledgeSourceFormat,
  type KnowledgeSourceScan,
  type StoredKnowledgeIndex
} from './knowledge-types.js'

const MAX_FILES = 400
const MAX_SCAN_ENTRIES = 20_000
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_NODES = 12_000
const MAX_EXTERNAL_REFERENCES = 4_000
const MAX_PDF_PAGES = 300
const SUPPORTED_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.pdf',
  ...KNOWLEDGE_OFFICE_EXTENSIONS
])
const SKIP_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.cache', '.idea', '.next', '.turbo', '.venv', '.vscode',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'temp', 'tmp', 'vendor', 'venv'
])

/**
 * Shared allowance for one request that scans several roots. Traversal fields
 * (`remainingDirectories`, `remainingEntries`, `remainingMetadataOps`,
 * `remainingFiles`) are charged during the walk itself — directory listing,
 * entry iteration, and per-file stat/realpath are real I/O, so a request-wide
 * budget must bound them, not just the rebuild that may follow.
 * `remainingBytes` is charged only when a rebuild actually reads file
 * contents, since the walk never does.
 */
export type KnowledgeScanBudget = {
  remainingFiles: number
  remainingBytes: number
  remainingDirectories: number
  remainingEntries: number
  remainingMetadataOps: number
}

/** True when the walk-time portion of the budget has nothing left to spend. */
export function scanBudgetExhausted(budget: KnowledgeScanBudget): boolean {
  return budget.remainingFiles <= 0 ||
    budget.remainingDirectories <= 0 ||
    budget.remainingEntries <= 0 ||
    budget.remainingMetadataOps <= 0
}

export async function scanKnowledgeSources(
  rootInput: string,
  budget?: KnowledgeScanBudget
): Promise<KnowledgeSourceScan> {
  const lexicalRoot = resolve(rootInput)
  if (budget) budget.remainingMetadataOps -= 1
  const physicalRoot = await realpath(lexicalRoot)
  const files: KnowledgeSourceFile[] = []
  const diagnostics: string[] = []
  const stack = [lexicalRoot]
  let entriesSeen = 0
  let bytesSeen = 0
  let budgetExhausted = budget ? scanBudgetExhausted(budget) : false

  while (stack.length > 0 && files.length < MAX_FILES && entriesSeen < MAX_SCAN_ENTRIES) {
    if (budget && scanBudgetExhausted(budget)) {
      budgetExhausted = true
      break
    }
    const directory = stack.pop()!
    if (budget) budget.remainingDirectories -= 1
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      pushDiagnostic(diagnostics, `Skipped unreadable directory ${displayPath(lexicalRoot, directory)}: ${message(error)}`)
      continue
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      entriesSeen += 1
      if (budget) budget.remainingEntries -= 1
      if (entriesSeen > MAX_SCAN_ENTRIES || files.length >= MAX_FILES) break
      if (budget && scanBudgetExhausted(budget)) {
        budgetExhausted = true
        break
      }
      if (entry.name === '.DS_Store' || entry.isSymbolicLink() || isTemporaryOfficeSource(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRECTORIES.has(entry.name)) stack.push(path)
        continue
      }
      if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())) continue
      let info
      let physicalPath
      try {
        if (budget) budget.remainingMetadataOps -= 2
        ;[info, physicalPath] = await Promise.all([stat(path), realpath(path)])
      } catch {
        continue
      }
      if (!isInside(physicalRoot, physicalPath)) {
        pushDiagnostic(diagnostics, `Skipped source outside knowledge root: ${displayPath(lexicalRoot, path)}`)
        continue
      }
      const fileLimit = KNOWLEDGE_OFFICE_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())
        ? MAX_KNOWLEDGE_OFFICE_FILE_BYTES
        : MAX_FILE_BYTES
      // An empty file is kept rather than skipped: it has no content to
      // retrieve, but it is still a file in the vault and must appear in the
      // graph, nested under its folder like any other note.
      const empty = info.size <= 0
      if (info.size > fileLimit || bytesSeen + info.size > MAX_TOTAL_BYTES) {
        pushDiagnostic(diagnostics, `Skipped oversized source: ${displayPath(lexicalRoot, path)}`)
        continue
      }
      const source = {
        absolutePath: path,
        relativePath: normalizeRelative(relative(lexicalRoot, path)),
        size: info.size,
        mtimeMs: Math.floor(info.mtimeMs),
        ...(Number.isFinite(info.birthtimeMs) && info.birthtimeMs > 0
          ? { birthtimeMs: Math.floor(info.birthtimeMs) }
          : {})
      }
      if (KNOWLEDGE_OFFICE_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())) {
        try {
          await validateOfficeSourceHeader(source)
        } catch (error) {
          pushDiagnostic(diagnostics, `Skipped invalid Office source ${source.relativePath}: ${message(error)}`)
          continue
        }
      }
      bytesSeen += info.size
      if (budget) budget.remainingFiles -= 1
      files.push(empty ? { ...source, empty: true } : source)
    }
  }
  // Only an actual early stop counts: a tree whose walk completed exactly as
  // the allowance reached zero still produced a full, trustworthy scan.
  if (budget && scanBudgetExhausted(budget) && stack.length > 0) budgetExhausted = true
  if (budgetExhausted) pushDiagnostic(diagnostics, 'Scan budget exhausted; the walk stopped early')
  if (files.length >= MAX_FILES) pushDiagnostic(diagnostics, `Index file limit reached (${MAX_FILES})`)
  if (entriesSeen >= MAX_SCAN_ENTRIES) pushDiagnostic(diagnostics, `Index scan-entry limit reached (${MAX_SCAN_ENTRIES})`)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return {
    root: lexicalRoot,
    files,
    diagnostics,
    fingerprint: hash(files.map((file) => `${file.relativePath}\0${file.size}\0${file.mtimeMs}`).join('\n')),
    ...(budgetExhausted ? { budgetExhausted: true } : {})
  }
}

export async function buildKnowledgeIndex(
  scan: KnowledgeSourceScan,
  nowIso: () => string = () => new Date().toISOString(),
  options: { officeArtifacts?: KnowledgeOfficeArtifactLoader } = {}
): Promise<StoredKnowledgeIndex> {
  const nodes: Record<string, KnowledgeNode> = {}
  const documents: KnowledgeDocument[] = []
  const references: KnowledgeReferenceEdge[] = []
  const externalReferences: KnowledgeExternalReferenceEdge[] = []
  const diagnostics = [...scan.diagnostics]
  const rootNodeId = nodeId('root', '.')
  nodes[rootNodeId] = node(rootNodeId, 'root', basename(scan.root) || scan.root, 'Knowledge base root', null)
  const directoryIds = new Map<string, string>([['.', rootNodeId]])
  const documentIds = new Map<string, string>()
  const pendingReferences: Array<{ fromId: string; sourcePath: string; target: string; label: string }> = []

  for (const file of scan.files) {
    if (Object.keys(nodes).length >= MAX_NODES) {
      pushDiagnostic(diagnostics, `Index node limit reached (${MAX_NODES})`)
      break
    }
    const parentId = ensureDirectoryNodes(file.relativePath, nodes, directoryIds, rootNodeId)
    const documentId = nodeId('document', file.relativePath)
    const documentNode = node(documentId, 'document', basename(file.relativePath), '', parentId, file.relativePath)
    nodes[documentId] = documentNode
    nodes[parentId]!.childIds.push(documentId)
    documentIds.set(normalizeRelative(file.relativePath), documentId)
    const document: KnowledgeDocument = {
      nodeId: documentId,
      relativePath: file.relativePath,
      size: file.size,
      mtimeMs: file.mtimeMs,
      ...(file.birthtimeMs ? { birthtimeMs: file.birthtimeMs } : {}),
      format: sourceFormat(file.relativePath),
      available: true
    }
    if (file.empty) {
      document.available = false
      document.error = 'Empty file'
      documentNode.summary = document.error
      documents.push(document)
      continue
    }
    try {
      const extension = extname(file.relativePath).toLocaleLowerCase()
      const availableNodes = Math.max(0, MAX_NODES - Object.keys(nodes).length)
      if (officeKnowledgeFormat(file.relativePath)) {
        if (!options.officeArtifacts) throw new Error('Office knowledge extraction is not configured')
        const loaded = await options.officeArtifacts.loadOrExtract(file)
        indexOfficeArtifact(file, loaded.artifact, documentNode, nodes, availableNodes)
        document.sourceSha256 = loaded.artifact.sourceSha256
        document.artifactKey = loaded.artifactKey
        document.extractorVersion = loaded.artifact.extractorVersion
        document.truncated = loaded.artifact.truncated
        for (const diagnostic of loaded.artifact.diagnostics) {
          pushDiagnostic(diagnostics, `${file.relativePath}: ${diagnostic}`)
        }
      } else if (extension === '.pdf') {
        await indexPdf(file, documentNode, nodes, availableNodes)
      } else {
        const buffer = await readFile(file.absolutePath)
        if (buffer.subarray(0, 4_096).includes(0)) throw new Error('binary content')
        const text = buffer.toString('utf8').replace(/\r\n?/g, '\n')
        if (extension === '.txt') indexText(file, text, documentNode, nodes, availableNodes)
        else indexMarkdown(file, text, documentNode, nodes, pendingReferences, availableNodes)
      }
      documentNode.summary = summarizeChildren(documentNode, nodes)
      if (documentNode.childIds.length === 0) {
        document.available = false
        document.error = 'No readable text was found'
      }
    } catch (error) {
      document.available = false
      document.error = clip(message(error), 300)
      documentNode.summary = document.error
      pushDiagnostic(diagnostics, `Could not index ${file.relativePath}: ${document.error}`)
    }
    documents.push(document)
  }

  for (const link of pendingReferences) {
    if (!nodes[link.fromId]) continue
    const targetPath = resolveKnowledgeLink(link.sourcePath, link.target)
    const toId = targetPath ? documentIds.get(targetPath) : undefined
    if (toId) {
      references.push({ fromId: link.fromId, toId, label: link.label })
      continue
    }
    // Unresolved inside this base: retained so a multi-root projection can
    // resolve it across workspaces instead of the link silently vanishing.
    if (externalReferences.length < MAX_EXTERNAL_REFERENCES) {
      externalReferences.push({
        fromId: link.fromId,
        sourcePath: link.sourcePath,
        target: link.target,
        label: link.label
      })
    }
  }
  summarizeDirectories(rootNodeId, nodes)
  return {
    version: KNOWLEDGE_INDEX_SCHEMA_VERSION,
    root: scan.root,
    fingerprint: scan.fingerprint,
    builtAt: nowIso(),
    rootNodeId,
    documents,
    nodes,
    references,
    externalReferences,
    diagnostics
  }
}

function indexOfficeArtifact(
  file: KnowledgeSourceFile,
  artifact: KnowledgeOfficeArtifact,
  documentNode: KnowledgeNode,
  nodes: Record<string, KnowledgeNode>,
  availableNodes: number
): void {
  const accepted = artifact.chunks.slice(0, availableNodes)
  const ids = new Map(accepted.map((chunk) => [
    chunk.key,
    nodeId(chunk.kind, `${file.relativePath}:${chunk.key}`)
  ]))
  for (const chunk of accepted) {
    const id = ids.get(chunk.key)!
    const parentId = chunk.parentKey ? ids.get(chunk.parentKey) ?? documentNode.id : documentNode.id
    nodes[id] = {
      ...node(id, chunk.kind, chunk.title, clip(chunk.summary, 280), parentId, file.relativePath),
      location: chunk.location,
      evidenceKey: chunk.key
    }
    nodes[parentId]!.childIds.push(id)
  }
}

function indexMarkdown(
  file: KnowledgeSourceFile,
  text: string,
  documentNode: KnowledgeNode,
  nodes: Record<string, KnowledgeNode>,
  pendingReferences: Array<{ fromId: string; sourcePath: string; target: string; label: string }>,
  availableNodes: number
): void {
  const lines = text.split('\n')
  const headings: Array<{ level: number; line: number; title: string; id: string; parentId: string }> = []
  const stack: Array<{ level: number; id: string }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!match) continue
    const level = match[1]!.length
    const title = match[2]!.trim()
    while (stack.length > 0 && stack.at(-1)!.level >= level) stack.pop()
    const parentId = stack.at(-1)?.id ?? documentNode.id
    const id = nodeId('section', `${file.relativePath}:${index + 1}`)
    headings.push({ level, line: index + 1, title, id, parentId })
    stack.push({ level, id })
  }
  if (headings.length === 0) {
    if (availableNodes > 0) addTextRange(file, lines, 1, lines.length, documentNode, nodes, 'Document text')
  } else {
    const firstHeadingLine = headings[0]!.line
    let nodesAdded = 0
    if (firstHeadingLine > 1 && availableNodes > 0) {
      nodesAdded += addTextRange(file, lines, 1, firstHeadingLine - 1, documentNode, nodes, 'Introduction') ? 1 : 0
    }
    headings.forEach((heading, index) => {
      if (nodesAdded >= availableNodes) return
      const nextBoundary = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
      const lineEnd = (nextBoundary?.line ?? lines.length + 1) - 1
      const summary = compact(lines.slice(heading.line, Math.min(lineEnd, heading.line + 8)).join(' '))
      nodes[heading.id] = {
        ...node(heading.id, 'section', heading.title, clip(summary, 280), heading.parentId, file.relativePath),
        location: { kind: 'text', lineStart: heading.line, lineEnd }
      }
      nodes[heading.parentId]!.childIds.push(heading.id)
      nodesAdded += 1
    })
  }
  collectMarkdownReferences(file.relativePath, lines, documentNode.id, pendingReferences)
}

function indexText(
  file: KnowledgeSourceFile,
  text: string,
  documentNode: KnowledgeNode,
  nodes: Record<string, KnowledgeNode>,
  availableNodes: number
): void {
  const lines = text.split('\n')
  let start = 1
  let paragraph = 1
  let nodesAdded = 0
  for (let index = 0; index <= lines.length; index += 1) {
    if (nodesAdded >= availableNodes) break
    if (index < lines.length && lines[index]!.trim()) continue
    if (index + 1 > start) {
      nodesAdded += addTextRange(file, lines, start, index, documentNode, nodes, `Paragraph ${paragraph}`) ? 1 : 0
      paragraph += 1
    }
    start = index + 2
  }
}

async function indexPdf(
  file: KnowledgeSourceFile,
  documentNode: KnowledgeNode,
  nodes: Record<string, KnowledgeNode>,
  availableNodes: number
): Promise<void> {
  const pages = await extractPdfPages(file.absolutePath)
  for (const page of pages.slice(0, availableNodes)) {
    if (!page.text) continue
    const id = nodeId('page', `${file.relativePath}:${page.page}`)
    nodes[id] = {
      ...node(id, 'page', `Page ${page.page}`, clip(page.text, 280), documentNode.id, file.relativePath),
      location: { kind: 'pdf', pageStart: page.page, pageEnd: page.page }
    }
    documentNode.childIds.push(id)
  }
}

export async function extractPdfPages(
  path: string,
  requestedPages?: ReadonlySet<number>
): Promise<Array<{ page: number; text: string }>> {
  ensurePdfNodePolyfills()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const bytes = await readFile(path)
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false
  } as unknown as Parameters<typeof pdfjs.getDocument>[0])
  const document = await task.promise
  const pages: Array<{ page: number; text: string }> = []
  try {
    const limit = Math.min(document.numPages, MAX_PDF_PAGES)
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      if (requestedPages && !requestedPages.has(pageNumber)) continue
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const text = compact((content.items as Array<{ str?: string }>).map((item) => item.str ?? '').join(' '))
        pages.push({ page: pageNumber, text })
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await document.destroy()
  }
  return pages
}

function addTextRange(
  file: KnowledgeSourceFile,
  lines: string[],
  lineStart: number,
  lineEnd: number,
  parent: KnowledgeNode,
  nodes: Record<string, KnowledgeNode>,
  title: string
): boolean {
  const summary = compact(lines.slice(lineStart - 1, lineEnd).join(' '))
  if (!summary) return false
  const id = nodeId('range', `${file.relativePath}:${lineStart}`)
  nodes[id] = {
    ...node(id, 'range', title, clip(summary, 280), parent.id, file.relativePath),
    location: { kind: 'text', lineStart, lineEnd }
  }
  parent.childIds.push(id)
  return true
}

function ensureDirectoryNodes(
  relativePath: string,
  nodes: Record<string, KnowledgeNode>,
  ids: Map<string, string>,
  rootId: string
): string {
  const parts = normalizeRelative(dirname(relativePath)).split('/').filter((part) => part && part !== '.')
  let currentPath = '.'
  let parentId = rootId
  for (const part of parts) {
    currentPath = currentPath === '.' ? part : `${currentPath}/${part}`
    let id = ids.get(currentPath)
    if (!id) {
      id = nodeId('directory', currentPath)
      nodes[id] = node(id, 'directory', part, '', parentId)
      nodes[parentId]!.childIds.push(id)
      ids.set(currentPath, id)
    }
    parentId = id
  }
  return parentId
}

function collectMarkdownReferences(
  sourcePath: string,
  lines: string[],
  fromId: string,
  output: Array<{ fromId: string; sourcePath: string; target: string; label: string }>
): void {
  const markdownLink = /\[([^\]]+)\]\(([^)]+)\)/g
  const wikiLink = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  for (const line of lines) {
    for (const match of line.matchAll(markdownLink)) {
      output.push({ fromId, sourcePath, target: match[2]!, label: match[1]! })
    }
    for (const match of line.matchAll(wikiLink)) {
      output.push({ fromId, sourcePath, target: match[1]!, label: match[2] ?? match[1]! })
    }
  }
}

function resolveKnowledgeLink(sourcePath: string, target: string): string | null {
  const raw = target.split('#', 1)[0]!.split('?', 1)[0]!.trim()
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || isAbsolute(raw)) return null
  let resolved = normalizeRelative(join(dirname(sourcePath), raw))
  if (!extname(resolved)) resolved = `${resolved}.md`
  if (resolved === '..' || resolved.startsWith('../')) return null
  return resolved
}

function summarizeDirectories(id: string, nodes: Record<string, KnowledgeNode>): string {
  const current = nodes[id]!
  for (const childId of current.childIds) {
    const child = nodes[childId]!
    if (child.kind === 'directory') summarizeDirectories(childId, nodes)
  }
  current.summary = clip(current.childIds.map((childId) => nodes[childId]!.title).join(', '), 280)
  return current.summary
}

function summarizeChildren(parent: KnowledgeNode, nodes: Record<string, KnowledgeNode>): string {
  return clip(parent.childIds.map((id) => `${nodes[id]!.title}: ${nodes[id]!.summary}`).join(' '), 280)
}

function node(
  id: string,
  kind: KnowledgeNode['kind'],
  title: string,
  summary: string,
  parentId: string | null,
  relativePath?: string
): KnowledgeNode {
  return { id, kind, title, summary, parentId, childIds: [], ...(relativePath ? { relativePath } : {}) }
}

function nodeId(kind: string, key: string): string {
  return `kn_${hash(`${kind}\0${key}`).slice(0, 20)}`
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`
}

function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/') || '.'
}

function sourceFormat(path: string): KnowledgeSourceFormat {
  const officeFormat = officeKnowledgeFormat(path)
  if (officeFormat) return officeFormat
  const extension = extname(path).toLocaleLowerCase()
  if (extension === '.pdf') return 'pdf'
  if (extension === '.txt') return 'text'
  return 'markdown'
}

function displayPath(root: string, path: string): string {
  return normalizeRelative(relative(root, path) || '.')
}

function isInside(root: string, path: string): boolean {
  const result = relative(root, path)
  return result === '' || (!result.startsWith('..') && !isAbsolute(result))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pushDiagnostic(diagnostics: string[], value: string): void {
  if (diagnostics.length < 50) diagnostics.push(clip(value, 500))
}

function ensurePdfNodePolyfills(): void {
  const target = globalThis as unknown as Record<string, unknown>
  target.DOMMatrix ??= class DOMMatrix {}
  target.ImageData ??= class ImageData {}
  target.Path2D ??= class Path2D {}
}
