import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { DOMParser, type Element } from '@xmldom/xmldom'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'

/**
 * Repairs a PPTX package whose `<p:notesMasterIdLst>` sits outside the
 * CT_Presentation child sequence that OfficeCLI validates against. Such a deck
 * is rejected by `officecli validate`, so every edit fails even when the edit
 * itself is unrelated and correct.
 *
 * The repair only moves one existing, resolvable notes master list inside
 * `ppt/presentation.xml`. Ambiguous packages (duplicate lists, dangling
 * relationship ids, unknown sibling elements) are refused instead of guessed.
 */

const PRESENTATION_PART = 'ppt/presentation.xml'
const PRESENTATION_RELATIONSHIPS_PART = 'ppt/_rels/presentation.xml.rels'
const PRESENTATION_NAMESPACE = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NOTES_MASTER_RELATIONSHIP_SUFFIX = '/notesMaster'

const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_PART_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024

/**
 * CT_Presentation child sequence (ECMA-376). Only these elements are ordered
 * here; an unexpected sibling makes the repair target position unknowable.
 */
const PRESENTATION_CHILD_ORDER = [
  'sldmasteridlst',
  'notesmasteridlst',
  'handoutmasteridlst',
  'sldidlst',
  'sldsz',
  'notessz',
  'smarttags',
  'embeddedfontlst',
  'custshowlst',
  'photoalbum',
  'custdatalst',
  'kinsoku',
  'defaulttextstyle',
  'modifyverifier',
  'extlst'
]

const NOTES_MASTER_LIST_RANK = PRESENTATION_CHILD_ORDER.indexOf('notesmasteridlst')

export type PptxStructureRepair = {
  part: string
  action: 'moved-notes-master-id-list'
}

type PptxEntry = {
  name: string
  data: Buffer
  compress: boolean
  mode: number
  mtime: Date
}

type PptxArchive = {
  entries: PptxEntry[]
  parts: Map<string, Buffer>
}

type SourceSpan = { name: string; start: number; end: number }

export async function repairPptxPresentationChildOrder(
  filePath: string
): Promise<PptxStructureRepair[]> {
  const inspected = await readPptxParts(filePath, [PRESENTATION_PART, PRESENTATION_RELATIONSHIPS_PART])
  const presentation = inspected.parts.get(PRESENTATION_PART)
  if (!presentation) throw new Error('PPTX package has no ppt/presentation.xml part.')
  const repairedXml = reorderNotesMasterIdList(presentation.toString('utf8'), inspected.parts)
  // Healthy packages are never rewritten; only a confirmed defect pays the cost
  // of buffering the whole package for the rewrite.
  if (!repairedXml) return []
  const archive = await readPptxArchive(filePath)
  await writePptxArchive(filePath, archive, repairedXml)
  return [{ part: PRESENTATION_PART, action: 'moved-notes-master-id-list' }]
}

function reorderNotesMasterIdList(
  source: string,
  parts: Map<string, Buffer>
): string | undefined {
  const root = parseOfficeXml(source, PRESENTATION_PART)
  if (root.namespaceURI !== PRESENTATION_NAMESPACE || elementName(root) !== 'presentation') {
    throw new Error('PPTX presentation part has an unexpected root element.')
  }
  const children = directElements(root)
  const notesLists = children.filter((child) => elementName(child) === 'notesmasteridlst')
  if (notesLists.length === 0) return undefined
  if (notesLists.length > 1) {
    throw new Error('presentation.xml declares more than one notesMasterIdLst.')
  }
  const notesList = notesLists[0]!
  const relationshipId = notesMasterRelationshipId(notesList)
  assertNotesMasterRelationship(parts, relationshipId)

  const notesIndex = children.indexOf(notesList)
  if (isNotesListPositioned(children, notesIndex)) return undefined

  const spans = scanPresentationChildren(source).children
  if (spans.length !== children.length) {
    throw new Error('presentation.xml child elements could not be located in the source text.')
  }
  const target = placementTarget(children, spans, notesIndex)
  const removed = source.slice(spans[notesIndex]!.start, spans[notesIndex]!.end)
  const withoutList = source.slice(0, spans[notesIndex]!.start) + source.slice(spans[notesIndex]!.end)
  const insertion = target.start > spans[notesIndex]!.start ? target.start - removed.length : target.start
  const repaired = withoutList.slice(0, insertion) + removed + withoutList.slice(insertion)

  assertRepairedOrder(repaired, relationshipId)
  return repaired
}

function isNotesListPositioned(children: Element[], notesIndex: number): boolean {
  for (let index = 0; index < children.length; index += 1) {
    const rank = childRank(elementName(children[index]!))
    if (rank === undefined) continue
    if (index < notesIndex && rank >= NOTES_MASTER_LIST_RANK) return false
    if (index > notesIndex && rank <= NOTES_MASTER_LIST_RANK) return false
  }
  return true
}

function placementTarget(children: Element[], spans: SourceSpan[], notesIndex: number): SourceSpan {
  let last: SourceSpan | undefined
  for (let index = 0; index < children.length; index += 1) {
    if (index === notesIndex) continue
    const rank = childRank(elementName(children[index]!))
    if (rank === undefined) {
      throw new Error(
        `Cannot place notesMasterIdLst safely: unsupported presentation child <${spans[index]!.name}>.`
      )
    }
    if (rank > NOTES_MASTER_LIST_RANK) return spans[index]!
    last = spans[index]!
  }
  if (!last) {
    throw new Error('Cannot place notesMasterIdLst safely: presentation has no sibling elements.')
  }
  return { name: last.name, start: last.end, end: last.end }
}

function assertRepairedOrder(source: string, expectedRelationshipId: string): void {
  const root = parseOfficeXml(source, PRESENTATION_PART)
  const children = directElements(root)
  let previous = -1
  for (const child of children) {
    const rank = childRank(elementName(child))
    if (rank === undefined) {
      throw new Error(`Repaired presentation.xml contains unsupported child <${elementName(child)}>.`)
    }
    if (rank <= previous) {
      throw new Error('Repaired presentation.xml still violates the CT_Presentation order.')
    }
    previous = rank
  }
  const notesList = children.find((child) => elementName(child) === 'notesmasteridlst')
  if (!notesList || notesMasterRelationshipId(notesList) !== expectedRelationshipId) {
    throw new Error('Repaired presentation.xml lost its notes master reference.')
  }
}

function notesMasterRelationshipId(notesList: Element): string {
  const entries = directElements(notesList)
  if (entries.length !== 1 || elementName(entries[0]!) !== 'notesmasterid') {
    throw new Error('notesMasterIdLst must contain exactly one notesMasterId element.')
  }
  const relationshipId = relationshipIdAttribute(entries[0]!)
  if (!relationshipId) throw new Error('notesMasterId has no relationship id.')
  return relationshipId
}

function assertNotesMasterRelationship(parts: Map<string, Buffer>, relationshipId: string): void {
  const relationships = parts.get(PRESENTATION_RELATIONSHIPS_PART)
  if (!relationships) {
    throw new Error('PPTX package has no presentation relationships part.')
  }
  const root = parseOfficeXml(relationships.toString('utf8'), PRESENTATION_RELATIONSHIPS_PART)
  if (root.namespaceURI !== RELATIONSHIPS_NAMESPACE || elementName(root) !== 'relationships') {
    throw new Error('PPTX presentation relationships part has an unexpected root element.')
  }
  const match = directElements(root).find(
    (relationship) => relationship.getAttribute('Id') === relationshipId
  )
  if (!match) {
    throw new Error(
      `notesMasterIdLst references ${relationshipId}, which the presentation relationships do not define.`
    )
  }
  if (!(match.getAttribute('Type') || '').endsWith(NOTES_MASTER_RELATIONSHIP_SUFFIX)) {
    throw new Error(`notesMasterIdLst references ${relationshipId}, which is not a notes master.`)
  }
}

function relationshipIdAttribute(element: Element): string {
  const namespaced = element.getAttributeNS(OFFICE_RELATIONSHIPS_NAMESPACE, 'id')
  if (namespaced) return namespaced
  const attributes = element.attributes
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes.item(index)
    if (attribute && attribute.localName === 'id' && attribute.name.includes(':')) {
      return attribute.value
    }
  }
  return ''
}

function parseOfficeXml(source: string, label: string): Element {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error(`${label} contains a forbidden XML declaration.`)
  }
  const errors: string[] = []
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(message)
    }
  })
  const document = parser.parseFromString(source, 'application/xml')
  if (!document.documentElement || errors.length > 0) {
    throw new Error(`${label} is malformed XML${errors[0] ? `: ${errors[0]}` : ''}.`)
  }
  return document.documentElement
}

function directElements(element: Element): Element[] {
  const output: Element[] = []
  const nodes = element.childNodes
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index)
    if (node && node.nodeType === 1) output.push(node as Element)
  }
  return output
}

function elementName(element: Element): string {
  return (element.localName || element.tagName.split(':').pop() || element.tagName).toLowerCase()
}

function childRank(name: string): number | undefined {
  const rank = PRESENTATION_CHILD_ORDER.indexOf(name)
  return rank < 0 ? undefined : rank
}

function scanPresentationChildren(source: string): { children: SourceSpan[] } {
  const children: SourceSpan[] = []
  let current: SourceSpan | undefined
  let depth = 0
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open < 0) break
    if (source.startsWith('<!--', open)) {
      index = skipPast(source, '-->', open + 4)
      continue
    }
    if (source.startsWith('<![CDATA[', open)) {
      index = skipPast(source, ']]>', open + 9)
      continue
    }
    if (source.startsWith('<?', open)) {
      index = skipPast(source, '?>', open + 2)
      continue
    }
    if (source.startsWith('</', open)) {
      const close = source.indexOf('>', open)
      if (close < 0) break
      index = close + 1
      depth -= 1
      if (depth === 1 && current) {
        current.end = index
        children.push(current)
        current = undefined
      }
      if (depth === 0) break
      continue
    }
    const tag = readStartTag(source, open)
    if (depth === 1) {
      if (tag.selfClosing) children.push({ name: tag.name, start: open, end: tag.end })
      else current = { name: tag.name, start: open, end: -1 }
    }
    if (!tag.selfClosing) depth += 1
    index = tag.end
  }
  if (current) throw new Error('PPTX presentation part has an unterminated child element.')
  return { children }
}

function skipPast(source: string, terminator: string, from: number): number {
  const position = source.indexOf(terminator, from)
  return position < 0 ? source.length : position + terminator.length
}

function readStartTag(
  source: string,
  start: number
): { name: string; end: number; selfClosing: boolean } {
  let index = start + 1
  const nameStart = index
  while (index < source.length && !/[\s/>]/.test(source[index]!)) index += 1
  const name = source.slice(nameStart, index)
  let quote = ''
  while (index < source.length) {
    const character = source[index]!
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return { name, end: index + 1, selfClosing: source[index - 1] === '/' }
    }
    index += 1
  }
  throw new Error('PPTX presentation part has an unterminated element.')
}

async function readPptxParts(
  filePath: string,
  names: readonly string[]
): Promise<{ parts: Map<string, Buffer> }> {
  const wanted = new Set(names)
  const parts = new Map<string, Buffer>()
  const zipfile = await yauzl.openPromise(filePath, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    autoClose: false
  })
  try {
    for await (const entry of zipfile.eachEntry()) {
      if (!wanted.has(entry.fileName)) continue
      if (entry.uncompressedSize > MAX_PART_BYTES) {
        throw new Error(`PPTX part is unexpectedly large: ${entry.fileName}`)
      }
      parts.set(entry.fileName, await readEntry(zipfile, entry))
    }
  } finally {
    zipfile.close()
  }
  return { parts }
}

async function readPptxArchive(filePath: string): Promise<PptxArchive> {
  const entries: PptxEntry[] = []
  const parts = new Map<string, Buffer>()
  let totalBytes = 0
  const zipfile = await yauzl.openPromise(filePath, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    autoClose: false
  })
  try {
    if (zipfile.entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`PPTX package has too many parts (${zipfile.entryCount}).`)
    }
    for await (const entry of zipfile.eachEntry()) {
      if (entry.uncompressedSize > MAX_PART_BYTES) {
        throw new Error(`PPTX part is unexpectedly large: ${entry.fileName}`)
      }
      totalBytes += entry.uncompressedSize
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error('PPTX package expands beyond the supported size.')
      }
      const directory = entry.fileName.endsWith('/')
      const data = directory ? Buffer.alloc(0) : await readEntry(zipfile, entry)
      entries.push({
        name: entry.fileName,
        data,
        compress: entry.compressionMethod === 8,
        mode: entryMode(entry, directory),
        mtime: entry.getLastModDate()
      })
      parts.set(entry.fileName, data)
    }
  } finally {
    zipfile.close()
  }
  return { entries, parts }
}

async function readEntry(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  const stream = await zipfile.openReadStreamPromise(entry)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

function entryMode(entry: yauzl.Entry, directory: boolean): number {
  const permissions = (entry.externalFileAttributes >>> 16) & 0o7777
  const type = directory ? 0o40000 : 0o100000
  return type | (permissions === 0 ? (directory ? 0o755 : 0o644) : permissions)
}

async function writePptxArchive(
  filePath: string,
  archive: PptxArchive,
  presentationXml: string
): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.repair`
  const zipfile = new yazl.ZipFile()
  for (const entry of archive.entries) {
    if (entry.name.endsWith('/')) {
      zipfile.addEmptyDirectory(entry.name, { mtime: entry.mtime, mode: entry.mode })
      continue
    }
    const data = entry.name === PRESENTATION_PART
      ? Buffer.from(presentationXml, 'utf8')
      : entry.data
    zipfile.addBuffer(data, entry.name, {
      mtime: entry.mtime,
      mode: entry.mode,
      compress: entry.compress
    })
  }
  try {
    zipfile.end()
    await pipeline(
      zipfile.outputStream,
      createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })
    )
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}
