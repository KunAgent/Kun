/**
 * What changed between two versions of an Office file, for the artifact chat
 * panel's change card and the slide rail's "changed" badges. Pure apart from
 * lazily loading JSZip / SheetJS; a parse failure yields `unknown`.
 */

export type ArtifactParagraphChange = { index: number; before: string; after: string }
export type ArtifactSheetChange = { name: string; ranges: string[]; cellCount: number; added?: boolean; removed?: boolean }

export type ArtifactOfficeChange =
  | { kind: 'presentation'; changedSlides: number[]; addedSlides: number[]; removedSlides: number; slideCount: number }
  | { kind: 'word'; paragraphs: ArtifactParagraphChange[]; changedCount: number; removedChars: number; addedChars: number }
  | { kind: 'spreadsheet'; sheets: ArtifactSheetChange[]; cellCount: number }
  | { kind: 'unknown' }

export type ArtifactOfficeFormat = 'pptx' | 'docx' | 'xlsx'

const MAX_REPORTED_PARAGRAPHS = 20
const MAX_REPORTED_RANGES = 6

export async function diffOfficeVersions(
  format: ArtifactOfficeFormat,
  before: Uint8Array,
  after: Uint8Array
): Promise<ArtifactOfficeChange> {
  try {
    if (format === 'pptx') return await diffPresentation(before, after)
    if (format === 'docx') return await diffWord(before, after)
    return await diffSpreadsheet(before, after)
  } catch {
    return { kind: 'unknown' }
  }
}

type Zip = import('jszip')

async function loadZip(bytes: Uint8Array): Promise<Zip> {
  const { default: JSZip } = await import('jszip')
  return JSZip.loadAsync(bytes)
}

function attributes(tag: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) values[match[1]!] = match[2]!
  return values
}

function relationships(xml: string): Array<{ id: string; type: string; target: string; external: boolean }> {
  return [...xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((match) => {
    const values = attributes(match[0])
    return {
      id: values.Id ?? '',
      type: values.Type ?? '',
      target: values.Target ?? '',
      external: values.TargetMode === 'External'
    }
  })
}

/** Resolves a relationship target against the folder of the part that owns it. */
export function resolvePartPath(baseFolder: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${baseFolder}/${target}`).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') resolved.pop()
    else resolved.push(part)
  }
  return resolved.join('/')
}

async function text(zip: Zip, path: string): Promise<string> {
  return (await zip.file(path)?.async('string')) ?? ''
}

function fnv(bytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

async function orderedSlideParts(zip: Zip): Promise<string[]> {
  const presentation = await text(zip, 'ppt/presentation.xml')
  const rels = new Map(relationships(await text(zip, 'ppt/_rels/presentation.xml.rels')).map((rel) => [rel.id, rel]))
  const parts: string[] = []
  for (const match of presentation.matchAll(/<(?:\w+:)?sldId\b[^>]*>/g)) {
    const relId = Object.entries(attributes(match[0])).find(([name]) => /^\w+:id$/.test(name))?.[1]
    const rel = relId ? rels.get(relId) : undefined
    if (rel && !rel.external) parts.push(resolvePartPath('ppt', rel.target))
  }
  return parts
}

/** A slide's identity covers its XML, its rels and the parts they pull in, except the shared layout. */
async function slideSignature(zip: Zip, part: string): Promise<string> {
  const folder = part.slice(0, part.lastIndexOf('/'))
  const name = part.slice(part.lastIndexOf('/') + 1)
  const relsPath = `${folder}/_rels/${name}.rels`
  const relsXml = await text(zip, relsPath)
  const pieces = [await text(zip, part), relsXml]
  for (const rel of relationships(relsXml)) {
    if (rel.external || /\/slideLayout$/.test(rel.type)) continue
    const bytes = await zip.file(resolvePartPath(folder, rel.target))?.async('uint8array')
    if (bytes) pieces.push(`${rel.target}:${bytes.length}:${fnv(bytes)}`)
  }
  return pieces.join('\u0000')
}

async function diffPresentation(before: Uint8Array, after: Uint8Array): Promise<ArtifactOfficeChange> {
  const [beforeZip, afterZip] = await Promise.all([loadZip(before), loadZip(after)])
  const [beforeParts, afterParts] = await Promise.all([orderedSlideParts(beforeZip), orderedSlideParts(afterZip)])
  const beforeSignatures = new Map<string, string>()
  for (const part of beforeParts) beforeSignatures.set(part, await slideSignature(beforeZip, part))
  const changedSlides: number[] = []
  const addedSlides: number[] = []
  for (const [index, part] of afterParts.entries()) {
    const previous = beforeSignatures.get(part)
    if (previous === undefined) addedSlides.push(index + 1)
    else if (previous !== await slideSignature(afterZip, part)) changedSlides.push(index + 1)
  }
  const afterSet = new Set(afterParts)
  return {
    kind: 'presentation',
    changedSlides,
    addedSlides,
    removedSlides: beforeParts.filter((part) => !afterSet.has(part)).length,
    slideCount: afterParts.length
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Paragraph texts of `word/document.xml`, in document order (table cells included). */
export function wordParagraphs(documentXml: string): string[] {
  const paragraphs: string[] = []
  for (const match of documentXml.matchAll(/<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g)) {
    let value = ''
    for (const piece of match[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
      value += piece[1] !== undefined ? decodeXml(piece[1]) : piece[0].startsWith('<w:tab') ? '\t' : '\n'
    }
    paragraphs.push(value)
  }
  return paragraphs
}

function commonEdges(left: string, right: string): number {
  const a = Array.from(left)
  const b = Array.from(right)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1
  return prefix + suffix
}

export function diffParagraphs(before: readonly string[], after: readonly string[]): Omit<Extract<ArtifactOfficeChange, { kind: 'word' }>, 'kind'> {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  const paragraphs: ArtifactParagraphChange[] = []
  let removedChars = 0
  let addedChars = 0
  const span = Math.max(endBefore - start, endAfter - start)
  for (let offset = 0; offset < span; offset += 1) {
    const previous = start + offset < endBefore ? before[start + offset]! : ''
    const next = start + offset < endAfter ? after[start + offset]! : ''
    if (previous === next) continue
    const shared = commonEdges(previous, next)
    removedChars += Array.from(previous).length - shared
    addedChars += Array.from(next).length - shared
    paragraphs.push({ index: Math.min(start + offset, Math.max(0, after.length - 1)), before: previous, after: next })
  }
  return { paragraphs: paragraphs.slice(0, MAX_REPORTED_PARAGRAPHS), changedCount: paragraphs.length, removedChars, addedChars }
}

async function diffWord(before: Uint8Array, after: Uint8Array): Promise<ArtifactOfficeChange> {
  const [beforeZip, afterZip] = await Promise.all([loadZip(before), loadZip(after)])
  const [beforeXml, afterXml] = await Promise.all([text(beforeZip, 'word/document.xml'), text(afterZip, 'word/document.xml')])
  if (!afterXml) return { kind: 'unknown' }
  return { kind: 'word', ...diffParagraphs(wordParagraphs(beforeXml), wordParagraphs(afterXml)) }
}

type CellSignatures = Map<string, string>

async function sheetCells(bytes: Uint8Array): Promise<Map<string, CellSignatures>> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellStyles: false, cellDates: false })
  const sheets = new Map<string, CellSignatures>()
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name] ?? {}
    const cells: CellSignatures = new Map()
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue
      const value = cell as { f?: string; v?: unknown; t?: string }
      cells.set(address, `${value.t ?? ''}|${value.f ?? ''}|${String(value.v ?? '')}`)
    }
    sheets.set(name, cells)
  }
  return sheets
}

function columnNumber(letters: string): number {
  let value = 0
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64)
  return value
}

function columnLetters(column: number): string {
  let value = column
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

/** Groups changed cells into rectangles: row runs per column, then equal runs across adjacent columns. */
export function changedRanges(addresses: Iterable<string>): string[] {
  const byColumn = new Map<number, number[]>()
  for (const address of addresses) {
    const match = /^([A-Z]+)(\d+)$/.exec(address)
    if (!match) continue
    const column = columnNumber(match[1]!)
    byColumn.set(column, [...(byColumn.get(column) ?? []), Number(match[2])])
  }
  const runs: Array<{ c1: number; c2: number; r1: number; r2: number }> = []
  for (const [column, rows] of [...byColumn].sort((left, right) => left[0] - right[0])) {
    const sorted = [...new Set(rows)].sort((left, right) => left - right)
    let r1 = sorted[0]!
    let previous = r1
    for (const row of [...sorted.slice(1), Number.POSITIVE_INFINITY]) {
      if (row === previous + 1) { previous = row; continue }
      const extendable = runs.find((run) => run.c2 === column - 1 && run.r1 === r1 && run.r2 === previous)
      if (extendable) extendable.c2 = column
      else runs.push({ c1: column, c2: column, r1, r2: previous })
      r1 = row
      previous = row
    }
  }
  return runs
    .sort((left, right) => left.r1 - right.r1 || left.c1 - right.c1)
    .map((run) => {
      const start = `${columnLetters(run.c1)}${run.r1}`
      const end = `${columnLetters(run.c2)}${run.r2}`
      return start === end ? start : `${start}:${end}`
    })
}

async function diffSpreadsheet(before: Uint8Array, after: Uint8Array): Promise<ArtifactOfficeChange> {
  const [beforeSheets, afterSheets] = await Promise.all([sheetCells(before), sheetCells(after)])
  const sheets: ArtifactSheetChange[] = []
  let cellCount = 0
  for (const [name, cells] of afterSheets) {
    const previous = beforeSheets.get(name)
    if (!previous) {
      sheets.push({ name, ranges: [], cellCount: cells.size, added: true })
      cellCount += cells.size
      continue
    }
    const changed = new Set<string>()
    for (const [address, signature] of cells) if (previous.get(address) !== signature) changed.add(address)
    for (const address of previous.keys()) if (!cells.has(address)) changed.add(address)
    if (changed.size === 0) continue
    sheets.push({ name, ranges: changedRanges(changed).slice(0, MAX_REPORTED_RANGES), cellCount: changed.size })
    cellCount += changed.size
  }
  for (const name of beforeSheets.keys()) {
    if (!afterSheets.has(name)) sheets.push({ name, ranges: [], cellCount: 0, removed: true })
  }
  return { kind: 'spreadsheet', sheets, cellCount }
}

export function officeFormatForPath(path: string): ArtifactOfficeFormat | null {
  const extension = path.toLowerCase().match(/\.(pptx|docx|xlsx)$/)?.[1]
  return extension === 'pptx' || extension === 'docx' || extension === 'xlsx' ? extension : null
}

export function changeIsEmpty(change: ArtifactOfficeChange): boolean {
  if (change.kind === 'presentation') {
    return change.changedSlides.length === 0 && change.addedSlides.length === 0 && change.removedSlides === 0
  }
  if (change.kind === 'word') return change.changedCount === 0
  if (change.kind === 'spreadsheet') return change.sheets.length === 0
  return false
}
