import JSZip from 'jszip'
import type { WorkBook } from 'xlsx'
import type { WorkspaceSpreadsheetCellStylePatch } from '@shared/workspace-spreadsheet'

export type XlsxStyleOverrides = Record<string, Record<string, WorkspaceSpreadsheetCellStylePatch>>

type XmlAttributes = Record<string, string>

export async function readXlsxStyleOverrides(
  data: Uint8Array,
  workbook: WorkBook
): Promise<XlsxStyleOverrides> {
  const zip = await JSZip.loadAsync(data)
  const [workbookXml, relationshipsXml, stylesXml] = await Promise.all([
    readXml(zip, 'xl/workbook.xml'),
    readXml(zip, 'xl/_rels/workbook.xml.rels'),
    readXml(zip, 'xl/styles.xml')
  ])
  if (!workbookXml || !relationshipsXml || !stylesXml) return {}
  const relationshipTargets = parseRelationshipTargets(relationshipsXml)
  const sheetTargets = parseSheetTargets(workbookXml, relationshipTargets)
  const styles = parseCellStyles(stylesXml, workbook)
  const overrides: XlsxStyleOverrides = {}
  await Promise.all([...sheetTargets.entries()].map(async ([sheetName, target]) => {
    const sheetXml = await readXml(zip, normalizeWorksheetTarget(target))
    if (!sheetXml) return
    const cells: Record<string, WorkspaceSpreadsheetCellStylePatch> = {}
    for (const tag of sheetXml.matchAll(/<c\b([^>]*)>/g)) {
      const attributes = parseAttributes(tag[1] ?? '')
      const address = attributes.r?.toUpperCase()
      const styleIndex = Number(attributes.s)
      const style = Number.isInteger(styleIndex) ? styles[styleIndex] : undefined
      if (address && style && Object.keys(style).length > 0) cells[address] = structuredClone(style)
    }
    if (Object.keys(cells).length > 0) overrides[sheetName] = cells
  }))
  return overrides
}

function parseCellStyles(
  xml: string,
  workbook: WorkBook
): WorkspaceSpreadsheetCellStylePatch[] {
  const fonts = elementNodes(section(xml, 'fonts'), 'font').map((node) => parseFont(node.body))
  const fills = elementNodes(section(xml, 'fills'), 'fill').map((node) => parseFill(node.body))
  const borders = elementNodes(section(xml, 'borders'), 'border').map((node) => parseBorder(node.body))
  const formats = parseNumberFormats(xml, workbook)
  return elementNodes(section(xml, 'cellXfs'), 'xf').map(({ attributes, body }) => {
    const fontId = Number(attributes.fontId)
    const fillId = Number(attributes.fillId)
    const borderId = Number(attributes.borderId)
    const numberFormat = formats.get(Number(attributes.numFmtId))
    const alignmentTag = /<alignment\b([^>]*)\/?\s*>/.exec(body)?.[1]
    const alignment = alignmentTag ? parseAlignment(parseAttributes(alignmentTag)) : {}
    return compactStyle({
      ...(fonts[fontId] ?? {}),
      ...(fills[fillId] ?? {}),
      ...(borders[borderId] ?? {}),
      ...(numberFormat && numberFormat !== 'General' ? { numberFormat } : {}),
      ...alignment
    })
  })
}

function parseFont(body: string): WorkspaceSpreadsheetCellStylePatch {
  const name = elementAttributes(body, 'name').val
  const size = Number(elementAttributes(body, 'sz').val)
  const color = colorValue(elementAttributes(body, 'color'))
  const underline = elementAttributes(body, 'u')
  return compactStyle({
    ...(name ? { fontFamily: decodeXml(name) } : {}),
    ...(Number.isFinite(size) ? { fontSize: size } : {}),
    ...(/<b(?:\s[^>]*)?\/?\s*>/.test(body) ? { bold: true } : {}),
    ...(/<i(?:\s[^>]*)?\/?\s*>/.test(body) ? { italic: true } : {}),
    ...(/<strike(?:\s[^>]*)?\/?\s*>/.test(body) ? { strike: true } : {}),
    ...(Object.keys(underline).length > 0
      ? { underline: underline.val === 'double' ? 'double' as const : 'single' as const }
      : {}),
    ...(color ? { fontColor: color } : {})
  })
}

function parseFill(body: string): WorkspaceSpreadsheetCellStylePatch {
  const pattern = elementAttributes(body, 'patternFill')
  const color = colorValue(elementAttributes(body, 'fgColor'))
  return pattern.patternType === 'solid' && color ? { fillColor: color } : {}
}

function parseBorder(body: string): WorkspaceSpreadsheetCellStylePatch {
  const output: NonNullable<WorkspaceSpreadsheetCellStylePatch['borders']> = {}
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const node = elementNode(body, side)
    const rawStyle = node?.attributes.style
    if (!rawStyle) continue
    output[side] = {
      style: borderStyle(rawStyle),
      ...(node?.body ? { color: colorValue(elementAttributes(node.body, 'color')) } : {})
    }
  }
  return Object.keys(output).length ? { borders: output } : {}
}

function parseAlignment(attributes: XmlAttributes): WorkspaceSpreadsheetCellStylePatch {
  const horizontal = normalizeHorizontal(attributes.horizontal)
  const vertical = normalizeVertical(attributes.vertical)
  const rotation = Number(attributes.textRotation)
  return compactStyle({
    ...(horizontal ? { horizontalAlignment: horizontal } : {}),
    ...(vertical ? { verticalAlignment: vertical } : {}),
    ...(attributes.wrapText !== undefined ? { wrap: attributes.wrapText === '1' || attributes.wrapText === 'true' } : {}),
    ...(Number.isInteger(rotation) ? { textRotation: rotation } : {})
  })
}

function parseNumberFormats(xml: string, workbook: WorkBook): Map<number, string> {
  const formats = new Map<number, string>()
  const builtIn = (workbook as WorkBook & { SSF?: Record<string, string> }).SSF ?? {}
  for (const [id, pattern] of Object.entries(builtIn)) {
    if (pattern) formats.set(Number(id), pattern)
  }
  for (const tag of xml.matchAll(/<numFmt\b([^>]*)\/?\s*>/g)) {
    const attributes = parseAttributes(tag[1] ?? '')
    const id = Number(attributes.numFmtId)
    if (Number.isInteger(id) && attributes.formatCode) formats.set(id, decodeXml(attributes.formatCode))
  }
  return formats
}

function parseRelationshipTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>()
  for (const tag of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const attributes = parseAttributes(tag[1] ?? '')
    if (attributes.Id && attributes.Target) targets.set(attributes.Id, attributes.Target)
  }
  return targets
}

function parseSheetTargets(xml: string, relationships: Map<string, string>): Map<string, string> {
  const targets = new Map<string, string>()
  for (const tag of xml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attributes = parseAttributes(tag[1] ?? '')
    const target = relationships.get(attributes['r:id'] ?? '')
    if (attributes.name && target) targets.set(decodeXml(attributes.name), target)
  }
  return targets
}

function elementNodes(xml: string, name: string): Array<{ attributes: XmlAttributes; body: string }> {
  const nodes: Array<{ attributes: XmlAttributes; body: string }> = []
  const pattern = new RegExp(`<${name}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${name}>)`, 'g')
  for (const match of xml.matchAll(pattern)) {
    nodes.push({ attributes: parseAttributes(match[1] ?? ''), body: match[2] ?? '' })
  }
  return nodes
}

function elementNode(xml: string, name: string): { attributes: XmlAttributes; body: string } | undefined {
  return elementNodes(xml, name)[0]
}

function elementAttributes(xml: string, name: string): XmlAttributes {
  const match = new RegExp(`<${name}\\b([^>]*)\\/?\\s*>`).exec(xml)
  return parseAttributes(match?.[1] ?? '')
}

function section(xml: string, name: string): string {
  return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(xml)?.[1] ?? ''
}

function parseAttributes(raw: string): XmlAttributes {
  const attributes: XmlAttributes = {}
  for (const match of raw.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attributes[match[1]!] = match[2]!
  return attributes
}

async function readXml(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  if (!entry) return ''
  const value = await entry.async('string')
  if (value.length > 32 * 1024 * 1024) throw new Error(`XLSX XML part exceeds the renderer limit: ${path}`)
  return value
}

function normalizeWorksheetTarget(target: string): string {
  const normalized = target.replaceAll('\\', '/').replace(/^\/+/, '')
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized.replace(/^\.\//, '')}`
}

function colorValue(attributes: XmlAttributes): string | undefined {
  const raw = attributes.rgb?.replace(/^#/, '')
  if (!raw || !/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(raw)) return undefined
  return `#${raw.length === 8 ? raw.slice(2) : raw}`.toUpperCase()
}

function borderStyle(value: string): NonNullable<NonNullable<WorkspaceSpreadsheetCellStylePatch['borders']>['top']>['style'] {
  if (value === 'double') return 'double'
  if (value === 'thick') return 'thick'
  if (value.startsWith('medium')) return 'medium'
  if (value.includes('dash')) return 'dashed'
  if (value.includes('dot')) return 'dotted'
  if (value === 'none') return 'none'
  return 'thin'
}

function normalizeHorizontal(value?: string): WorkspaceSpreadsheetCellStylePatch['horizontalAlignment'] {
  if (value === 'left' || value === 'center' || value === 'right' || value === 'justify' || value === 'fill' || value === 'distributed') return value
  return undefined
}

function normalizeVertical(value?: string): WorkspaceSpreadsheetCellStylePatch['verticalAlignment'] {
  if (value === 'top' || value === 'center' || value === 'bottom') return value
  return undefined
}

function compactStyle(style: WorkspaceSpreadsheetCellStylePatch): WorkspaceSpreadsheetCellStylePatch {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) as WorkspaceSpreadsheetCellStylePatch
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}
