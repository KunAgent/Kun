import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom'
import { readPptxGeometryParts } from '../../ppt/ppt-geometry-qa-archive.js'
import type { PptxGeometryParts } from '../../ppt/ppt-geometry-qa-ooxml.js'

/**
 * Structural checks for exported PPTX packages plus small shared helpers for
 * the PPT deck tools: every slide must carry meaningful native content (not a
 * full-slide raster), transitions must match the request, and the bundled
 * toolchain is resolved from trusted runtime locations only.
 */

export const MAX_EXPORT_OUTPUT_CHARS = 16_000
const FULL_SLIDE_RASTER_COVERAGE = 0.9
const MIN_NATIVE_AREA_RATIO = 0.005
const MIN_NATIVE_FONT_SIZE = 600
const MIN_RASTER_TEXT_FONT_SIZE = 1_200
const MIN_RASTER_TEXT_CHARACTERS = 8
const MIN_RASTER_TEXT_DENSITY = 0.01
const MIN_SUBSTANTIVE_TEXT_CHARACTERS = 4
const MIN_SUBSTANTIVE_TEXT_DENSITY = 0.003
const DEFAULT_NATIVE_FONT_SIZE = 1_800
const EMUS_PER_POINT = 12_700

export type PptToolchainOptions = {
  toolchainDirectory?: () => string | undefined
}

type SlideSize = { width: number; height: number }
type SlideRect = { x: number; y: number; width: number; height: number }

function xmlElements(root: Element): Element[] {
  const output: Element[] = [root]
  const descendants = root.getElementsByTagName('*')
  for (let index = 0; index < descendants.length; index += 1) {
    const node = descendants.item(index)
    if (node?.nodeType === 1) output.push(node as Element)
  }
  return output
}

function xmlElementName(element: Element): string {
  return (element.localName || element.tagName.split(':').pop() || element.tagName).toLowerCase()
}

function parseOfficeXml(source: string, label: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error(`${label} contains a forbidden XML declaration`)
  const errors: string[] = []
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(message)
    }
  })
  const document = parser.parseFromString(source, 'application/xml')
  if (!document.documentElement || errors.length > 0) {
    throw new Error(`${label} is malformed XML${errors[0] ? `: ${errors[0]}` : ''}`)
  }
  return document
}

function documentRoot(document: Document): Element {
  const root = document.documentElement
  if (!root) throw new Error('Office XML document has no root element')
  return root
}

function slideSizeFromPresentation(source: string): SlideSize {
  const document = parseOfficeXml(source, 'ppt/presentation.xml')
  const slideSize = xmlElements(documentRoot(document))
    .find((element) => xmlElementName(element) === 'sldsz')
  const width = Number(slideSize?.getAttribute('cx'))
  const height = Number(slideSize?.getAttribute('cy'))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('presentation slide size is missing or invalid')
  }
  return { width, height }
}

function descendant(element: Element, name: string): Element | undefined {
  return xmlElements(element).find((candidate) => candidate !== element && xmlElementName(candidate) === name)
}

function elementRect(element: Element): SlideRect | undefined {
  const transform = descendant(element, 'xfrm')
  if (!transform) return undefined
  const transformElements = xmlElements(transform)
  const offset = transformElements.find((candidate) => xmlElementName(candidate) === 'off')
  const extent = transformElements.find((candidate) => xmlElementName(candidate) === 'ext')
  const x = Number(offset?.getAttribute('x'))
  const y = Number(offset?.getAttribute('y'))
  const width = Number(extent?.getAttribute('cx'))
  const height = Number(extent?.getAttribute('cy'))
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

function clippedRect(rect: SlideRect, size: SlideSize): SlideRect | undefined {
  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(size.width, rect.x + rect.width)
  const bottom = Math.min(size.height, rect.y + rect.height)
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : undefined
}

function rectAreaRatio(rect: SlideRect | undefined, size: SlideSize): number {
  const clipped = rect ? clippedRect(rect, size) : undefined
  return clipped ? (clipped.width * clipped.height) / (size.width * size.height) : 0
}

function intersectRects(first: SlideRect, second: SlideRect): SlideRect | undefined {
  const left = Math.max(first.x, second.x)
  const top = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : undefined
}

function unionAreaRatio(rects: SlideRect[], size: SlideSize): number {
  const clipped = rects.flatMap((rect) => {
    const value = clippedRect(rect, size)
    return value ? [value] : []
  })
  const xValues = [...new Set(clipped.flatMap((rect) => [rect.x, rect.x + rect.width]))]
    .sort((left, right) => left - right)
  let area = 0
  for (let index = 0; index < xValues.length - 1; index += 1) {
    const left = xValues[index]
    const right = xValues[index + 1]
    if (right <= left) continue
    const intervals = clipped
      .filter((rect) => rect.x < right && rect.x + rect.width > left)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((first, second) => first[0] - second[0])
    let coveredHeight = 0
    let intervalStart = 0
    let intervalEnd = 0
    for (const [start, end] of intervals) {
      if (end <= intervalEnd) continue
      if (start > intervalEnd) {
        coveredHeight += intervalEnd - intervalStart
        intervalStart = start
      }
      intervalEnd = end
    }
    coveredHeight += intervalEnd - intervalStart
    area += (right - left) * coveredHeight
  }
  return area / (size.width * size.height)
}

function visibleNativeAreaRatio(
  rect: SlideRect | undefined,
  coveringPictures: SlideRect[],
  size: SlideSize
): number {
  const clipped = rect ? clippedRect(rect, size) : undefined
  if (!clipped) return 0
  const covered = coveringPictures.flatMap((picture) => {
    const intersection = intersectRects(clipped, picture)
    return intersection ? [intersection] : []
  })
  return Math.max(0, rectAreaRatio(clipped, size) - unionAreaRatio(covered, size))
}

function numericAttributeIsZero(element: Element, attribute: string): boolean {
  const value = element.getAttribute(attribute)
  return value !== null && Number.isFinite(Number(value)) && Number(value) <= 0
}

function hasZeroAlpha(element: Element): boolean {
  return xmlElements(element).some((candidate) => {
    const name = xmlElementName(candidate)
    return (name === 'alpha' && numericAttributeIsZero(candidate, 'val')) ||
      ((name === 'alphamod' || name === 'alphamodfix') && numericAttributeIsZero(candidate, 'amt'))
  })
}

function isHidden(element: Element): boolean {
  return xmlElements(element).some((candidate) => {
    const hidden = candidate.getAttribute('hidden')?.trim().toLowerCase()
    return hidden === '1' || hidden === 'true'
  })
}

function ancestorNamed(node: Node, names: ReadonlySet<string>, boundary: Element): Element | undefined {
  let current = node.parentNode
  while (current && current !== boundary.parentNode) {
    if (current.nodeType === 1) {
      const element = current as Element
      if (names.has(xmlElementName(element))) return element
      if (element === boundary) break
    }
    current = current.parentNode
  }
  return undefined
}

type NativeTextEvidence = {
  basic: boolean
  substantive: boolean
  strong: boolean
}

function nativeTextEvidence(shape: Element, size: SlideSize, coveringPictures: SlideRect[]): NativeTextEvidence {
  if (isHidden(shape)) return { basic: false, substantive: false, strong: false }
  const bounds = elementRect(shape)
  const visibleAreaRatio = visibleNativeAreaRatio(bounds, coveringPictures, size)
  if (!bounds || visibleAreaRatio < MIN_NATIVE_AREA_RATIO) {
    return { basic: false, substantive: false, strong: false }
  }
  let basic = false
  let reasonableCharacters = 0
  let estimatedTextArea = 0
  for (const text of xmlElements(shape)
    .filter((element) => xmlElementName(element) === 't')
  ) {
    const content = (text.textContent ?? '').replace(/[\s\u00a0\u200b-\u200d\ufeff]+/gu, '')
    const characters = (content.match(/[\p{L}\p{N}]/gu) ?? []).length
    if (characters === 0) continue
    const run = ancestorNamed(text, new Set(['r', 'fld']), shape)
    if (run && hasZeroAlpha(run)) continue
    const properties = run ? xmlElements(run).find((element) => xmlElementName(element) === 'rpr') : undefined
    const explicitSize = properties?.getAttribute('sz')
    const fontSize = explicitSize === null || explicitSize === undefined
      ? DEFAULT_NATIVE_FONT_SIZE
      : Number(explicitSize)
    if (!Number.isFinite(fontSize) || fontSize < MIN_NATIVE_FONT_SIZE) continue
    if (characters >= 2) basic = true
    if (fontSize < MIN_RASTER_TEXT_FONT_SIZE) continue
    reasonableCharacters += characters
    const fontHeight = (fontSize / 100) * EMUS_PER_POINT
    estimatedTextArea += characters * fontHeight * fontHeight * 0.5
  }
  const clippedBounds = clippedRect(bounds, size)
  const textDensity = clippedBounds
    ? estimatedTextArea / (clippedBounds.width * clippedBounds.height)
    : 0
  return {
    basic,
    substantive: reasonableCharacters >= MIN_SUBSTANTIVE_TEXT_CHARACTERS &&
      textDensity >= MIN_SUBSTANTIVE_TEXT_DENSITY,
    strong: reasonableCharacters >= MIN_RASTER_TEXT_CHARACTERS &&
      textDensity >= MIN_RASTER_TEXT_DENSITY
  }
}

function hasVisiblePaint(shape: Element): boolean {
  if (isHidden(shape)) return false
  const shapeProperties = xmlElements(shape).find((element) => xmlElementName(element) === 'sppr')
  const style = xmlElements(shape).find((element) => xmlElementName(element) === 'style')
  if (style && !hasZeroAlpha(style)) return true
  if (!shapeProperties) return false
  return xmlElements(shapeProperties).some((element) => {
    const name = xmlElementName(element)
    return ['solidfill', 'gradfill', 'pattfill', 'blipfill'].includes(name) && !hasZeroAlpha(element)
  }) || xmlElements(shapeProperties).some((element) => {
    if (xmlElementName(element) !== 'ln' || hasZeroAlpha(element)) return false
    return !xmlElements(element).some((candidate) => xmlElementName(candidate) === 'nofill')
  })
}

function meaningfulNativeGeometry(shape: Element, size: SlideSize, coveringPictures: SlideRect[]): boolean {
  const rect = elementRect(shape)
  return hasVisiblePaint(shape) &&
    visibleNativeAreaRatio(rect, coveringPictures, size) >= MIN_NATIVE_AREA_RATIO
}

function meaningfulGraphicFrame(frame: Element, size: SlideSize, coveringPictures: SlideRect[]): boolean {
  if (isHidden(frame)) return false
  const rect = elementRect(frame)
  if (visibleNativeAreaRatio(rect, coveringPictures, size) < MIN_NATIVE_AREA_RATIO) return false
  const elements = xmlElements(frame)
  const graphicData = elements.find((element) => xmlElementName(element) === 'graphicdata')
  const uri = graphicData?.getAttribute('uri')?.toLowerCase() ?? ''
  return /(?:chart|table|diagram)/.test(uri) || elements.some((element) =>
    ['chart', 'tbl', 'relids', 'datamodel'].includes(xmlElementName(element)))
}

function slideHasMeaningfulNativeContent(
  document: Document,
  size: SlideSize,
  allowGeometryOnly: boolean
): boolean {
  const elements = xmlElements(documentRoot(document))
  let basicText = false
  let strongText = false
  let substantiveTextElements = 0
  let meaningfulGeometry = false
  let meaningfulData = false
  for (const [index, element] of elements.entries()) {
    const name = xmlElementName(element)
    if (!['sp', 'cxnsp', 'graphicframe'].includes(name)) continue
    const coveringPictures = elements.slice(index + 1).flatMap((candidate) => {
      if (xmlElementName(candidate) !== 'pic') return []
      const rect = elementRect(candidate)
      return rect ? [rect] : []
    })
    if (name === 'graphicframe') {
      meaningfulData ||= meaningfulGraphicFrame(element, size, coveringPictures)
      continue
    }
    const text = nativeTextEvidence(element, size, coveringPictures)
    basicText ||= text.basic
    strongText ||= text.strong
    if (text.substantive) substantiveTextElements += 1
    meaningfulGeometry ||= meaningfulNativeGeometry(element, size, coveringPictures)
  }
  return meaningfulData || (allowGeometryOnly
    ? basicText || meaningfulGeometry
    : strongText || substantiveTextElements >= 2)
}

function rasterCoverage(document: Document, size: SlideSize): { pictures: number; coverage: number } {
  const pictures = xmlElements(documentRoot(document))
    .filter((element) => xmlElementName(element) === 'pic')
  return {
    pictures: pictures.length,
    coverage: unionAreaRatio(pictures.flatMap((picture) => {
      const rect = elementRect(picture)
      return rect ? [rect] : []
    }), size)
  }
}

export async function validatePptx(
  path: string,
  transition: 'fade' | 'none'
): Promise<{
  slides: number
  editableSlides: number
  fadeTransitions: number
  bytes: number
  geometryParts: PptxGeometryParts
}> {
  const geometryParts = await readPptxGeometryParts(path)
  const slides = geometryParts.slides.length
  let editableSlides = 0
  let fadeTransitions = 0
  if (!geometryParts.contentTypesXml || !geometryParts.packageBytes || slides === 0) {
    throw new Error('exported file is not a valid PPTX presentation package')
  }
  const size = slideSizeFromPresentation(geometryParts.presentationXml)
  for (const slide of geometryParts.slides) {
    const document = parseOfficeXml(slide.xml, slide.path)
    if (/<p:transition\b[^>]*>[\s\S]*?<p:fade\b/.test(slide.xml)) fadeTransitions += 1
    const raster = rasterCoverage(document, size)
    if (slideHasMeaningfulNativeContent(
      document,
      size,
      raster.coverage < FULL_SLIDE_RASTER_COVERAGE
    )) {
      editableSlides += 1
      continue
    }
    if (raster.pictures > 0) {
      const dominance = raster.coverage >= FULL_SLIDE_RASTER_COVERAGE
        ? ` (raster coverage ${Math.round(raster.coverage * 100)}%)`
        : ''
      throw new Error(`editable deck verification failed: ${slide.path} contains only raster image content${dominance}; native overlays are empty, hidden, or too small`)
    }
    throw new Error(`editable deck verification failed: ${slide.path} has no meaningful native text, shape, chart, table, or diagram content`)
  }
  if (transition === 'fade' && fadeTransitions !== slides) {
    throw new Error(`fade transition verification failed: ${fadeTransitions}/${slides} slides`)
  }
  return {
    slides,
    editableSlides,
    fadeTransitions,
    bytes: geometryParts.packageBytes,
    geometryParts
  }
}

export async function requireToolchainDirectory(options: PptToolchainOptions): Promise<string> {
  const candidates = [
    options.toolchainDirectory?.()?.trim(),
    process.env.KUN_PPT_TOOLCHAIN_DIR?.trim(),
    resolve(process.cwd(), 'resources', 'ppt-toolchain'),
    resolve(process.cwd(), '..', 'resources', 'ppt-toolchain')
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) return resolve(candidate)
    } catch {
      // Try the next trusted runtime location.
    }
  }
  throw new Error('Kun PPT toolchain is unavailable; reinstall or repair the Kun application')
}

export function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function integerArg(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function truncate(value: string): string {
  if (value.length <= MAX_EXPORT_OUTPUT_CHARS) return value
  return `${value.slice(0, MAX_EXPORT_OUTPUT_CHARS)}\n…[truncated]`
}
