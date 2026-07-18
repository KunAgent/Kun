import {
  MAX_EDITABLE_CSS_LENGTH,
  applyEditableElementCss
} from './presentation-css.js'

export const PRESENTATION_SCHEMA_VERSION = 1 as const

export const MAX_PRESENTATION_HTML_BYTES = 900_000
export const MAX_PRESENTATION_JSON_BYTES = 700_000
export const MAX_PRESENTATION_SLIDES = 64
export const MAX_ELEMENTS_PER_SLIDE = 128
export const MAX_PRESENTATION_ELEMENTS = 1_024
export const MAX_PRESENTATION_OPERATIONS = 128
export const MAX_OPERATION_RECEIPTS = 64

export type PresentationFontFamily = 'sans' | 'serif' | 'mono'
export type PresentationTextAlign = 'left' | 'center' | 'right'
export type PresentationVerticalAlign = 'top' | 'middle' | 'bottom'
export type PresentationShapeKind = 'rectangle' | 'ellipse' | 'line'
export type PresentationImageFit = 'contain' | 'cover'

export interface PresentationTheme {
  backgroundColor: string
  textColor: string
  accentColor: string
  fontFamily: PresentationFontFamily
}

export interface PresentationOperationReceipt {
  operationId: string
  digest: string
  resultingRevision: number
}

interface PresentationElementBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export interface PresentationTextElement extends PresentationElementBase {
  type: 'text'
  text: string
  fontSize: number
  fontWeight: 400 | 500 | 600 | 700
  fontFamily?: PresentationFontFamily
  color: string
  align: PresentationTextAlign
  verticalAlign: PresentationVerticalAlign
}

export interface PresentationShapeElement extends PresentationElementBase {
  type: 'shape'
  shape: PresentationShapeKind
  fillColor: string
  strokeColor: string
  strokeWidth: number
  cornerRadius: number
}

export interface PresentationImageElement extends PresentationElementBase {
  type: 'image'
  src: string
  alt: string
  fit: PresentationImageFit
}

export type PresentationElement =
  | PresentationTextElement
  | PresentationShapeElement
  | PresentationImageElement

export interface PresentationSlide {
  id: string
  title: string
  backgroundColor: string | null
  elements: PresentationElement[]
}

export interface PresentationProject {
  schemaVersion: typeof PRESENTATION_SCHEMA_VERSION
  id: string
  revision: number
  title: string
  theme: PresentationTheme
  slides: PresentationSlide[]
  operationReceipts: PresentationOperationReceipt[]
}

export type PresentationDocumentPatch = {
  title?: string
  theme?: Partial<PresentationTheme>
}

export type PresentationSlidePatch = {
  title?: string
  backgroundColor?: string | null
}

export type PresentationOperation =
  | { kind: 'document.update'; patch: PresentationDocumentPatch }
  | { kind: 'slide.insert'; slide: PresentationSlide; index?: number }
  | { kind: 'slide.update'; slideId: string; patch: PresentationSlidePatch }
  | { kind: 'slide.delete'; slideId: string }
  | { kind: 'slide.reorder'; slideId: string; index: number }
  | { kind: 'element.upsert'; slideId: string; element: PresentationElement; index?: number }
  | { kind: 'element.style'; slideId: string; elementId: string; css: string }
  | { kind: 'element.delete'; slideId: string; elementId: string }

export interface PresentationValidationIssue {
  [key: string]: string
  code: string
  path: string
  message: string
}

export interface PresentationValidationResult {
  ok: boolean
  errors: PresentationValidationIssue[]
  warnings: PresentationValidationIssue[]
  project?: PresentationProject
}

export interface ApplyPresentationOperationsResult {
  project: PresentationProject
  changedIds: string[]
  inverseOperations: PresentationOperation[]
  warnings: PresentationValidationIssue[]
}

export class PresentationParseError extends Error {
  readonly issues: PresentationValidationIssue[]

  constructor(message: string, issues: PresentationValidationIssue[] = []) {
    super(message)
    this.name = 'PresentationParseError'
    this.issues = issues
  }
}

export class PresentationOperationError extends Error {
  readonly operationIndex: number

  constructor(message: string, operationIndex: number) {
    super(message)
    this.name = 'PresentationOperationError'
    this.operationIndex = operationIndex
  }
}

const DEFAULT_THEME: PresentationTheme = {
  backgroundColor: '#111827',
  textColor: '#F9FAFB',
  accentColor: '#6366F1',
  fontFamily: 'sans'
}

export function createPresentationSlide(
  id: string,
  title = 'Untitled slide'
): PresentationSlide {
  return { id, title, backgroundColor: null, elements: [] }
}

export function createPresentationProject(
  input: string | { id: string; title?: string; firstSlideId?: string } = 'presentation-1'
): PresentationProject {
  const options = typeof input === 'string' ? { id: input } : input
  return {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    id: options.id,
    revision: 1,
    title: options.title ?? 'Untitled presentation',
    theme: { ...DEFAULT_THEME },
    slides: [createPresentationSlide(options.firstSlideId ?? 'slide-1')],
    operationReceipts: []
  }
}

type TextElementOverrides = Partial<Omit<PresentationTextElement, 'id' | 'type'>>
type ShapeElementOverrides = Partial<Omit<PresentationShapeElement, 'id' | 'type'>>
type ImageElementOverrides = Partial<Omit<PresentationImageElement, 'id' | 'type' | 'src'>>

export function createTextElement(
  id: string,
  overrides: TextElementOverrides = {}
): PresentationTextElement {
  return {
    id,
    type: 'text',
    x: 10,
    y: 12,
    width: 80,
    height: 20,
    rotation: 0,
    opacity: 1,
    text: 'Text',
    fontSize: 48,
    fontWeight: 600,
    color: '#F9FAFB',
    align: 'left',
    verticalAlign: 'middle',
    ...overrides
  }
}

export function createShapeElement(
  id: string,
  overrides: ShapeElementOverrides = {}
): PresentationShapeElement {
  return {
    id,
    type: 'shape',
    x: 20,
    y: 30,
    width: 60,
    height: 30,
    rotation: 0,
    opacity: 1,
    shape: 'rectangle',
    fillColor: '#6366F1',
    strokeColor: '#6366F1',
    strokeWidth: 0,
    cornerRadius: 12,
    ...overrides
  }
}

export function createImageElement(
  id: string,
  src: string,
  overrides: ImageElementOverrides = {}
): PresentationImageElement {
  return {
    id,
    type: 'image',
    x: 20,
    y: 20,
    width: 60,
    height: 60,
    rotation: 0,
    opacity: 1,
    src,
    alt: '',
    fit: 'contain',
    ...overrides
  }
}

type JsonRecord = Record<string, unknown>

function issue(code: string, path: string, message: string): PresentationValidationIssue {
  return { code, path, message }
}

function fail(code: string, path: string, message: string): never {
  throw new PresentationParseError(message, [issue(code, path, message)])
}

function record(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_type', path, 'Expected an object')
  }
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail('unknown_field', `${path}.${key}`, 'Unknown field')
  }
  for (const key of allowed) {
    if (!(key in value)) fail('missing_field', `${path}.${key}`, 'Required field is missing')
  }
}

function exactKeysWithOptional(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string
): void {
  const allowedKeys = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail('unknown_field', `${path}.${key}`, 'Unknown field')
  }
  for (const key of required) {
    if (!(key in value)) fail('missing_field', `${path}.${key}`, 'Required field is missing')
  }
}

function stringValue(value: unknown, path: string, maxLength: number, nonEmpty = false): string {
  if (typeof value !== 'string') fail('invalid_type', path, 'Expected a string')
  if (value.length > maxLength) fail('string_too_long', path, `Must be at most ${maxLength} characters`)
  if (nonEmpty && value.trim().length === 0) fail('empty_string', path, 'Must not be empty')
  // eslint-disable-next-line no-control-regex -- explicit rejection of unsafe ASCII controls
  if (/\u0000|[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    fail('control_character', path, 'Control characters are not allowed')
  }
  return value
}

function idValue(value: unknown, path: string): string {
  const id = stringValue(value, path, 64, true)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    fail('invalid_id', path, 'IDs may contain only letters, digits, underscores, and hyphens')
  }
  return id
}

function colorValue(value: unknown, path: string): string {
  const color = stringValue(value, path, 7)
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) fail('invalid_color', path, 'Expected #RRGGBB')
  return color.toUpperCase()
}

function numberValue(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid_type', path, 'Expected a finite number')
  }
  if (value < min || value > max) fail('out_of_range', path, `Must be between ${min} and ${max}`)
  return Math.round(value * 10_000) / 10_000
}

function integerValue(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail('invalid_integer', path, `Expected an integer between ${min} and ${max}`)
  }
  return value as number
}

function enumValue<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[]
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('invalid_enum', path, `Expected one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function fontWeightValue(value: unknown, path: string): 400 | 500 | 600 | 700 {
  if (value !== 400 && value !== 500 && value !== 600 && value !== 700) {
    fail('invalid_enum', path, 'Expected one of: 400, 500, 600, 700')
  }
  return value
}

function parseTheme(value: unknown, path: string): PresentationTheme {
  const input = record(value, path)
  exactKeys(input, ['backgroundColor', 'textColor', 'accentColor', 'fontFamily'], path)
  return {
    backgroundColor: colorValue(input.backgroundColor, `${path}.backgroundColor`),
    textColor: colorValue(input.textColor, `${path}.textColor`),
    accentColor: colorValue(input.accentColor, `${path}.accentColor`),
    fontFamily: enumValue(input.fontFamily, `${path}.fontFamily`, ['sans', 'serif', 'mono'] as const)
  }
}

function parseElementBase(input: JsonRecord, path: string): PresentationElementBase {
  const x = numberValue(input.x, `${path}.x`, 0, 100)
  const y = numberValue(input.y, `${path}.y`, 0, 100)
  const width = numberValue(input.width, `${path}.width`, 0.1, 100)
  const height = numberValue(input.height, `${path}.height`, 0.1, 100)
  if (x + width > 100.0001 || y + height > 100.0001) {
    fail('outside_canvas', path, 'Element geometry must remain inside the 16:9 canvas')
  }
  return {
    id: idValue(input.id, `${path}.id`),
    x,
    y,
    width,
    height,
    rotation: numberValue(input.rotation, `${path}.rotation`, -180, 180),
    opacity: numberValue(input.opacity, `${path}.opacity`, 0, 1)
  }
}

function imagePathValue(value: unknown, path: string): string {
  const source = stringValue(value, path, 260, true)
  const segments = source.split('/')
  if (
    source.startsWith('/') || source.includes('\\') || source.includes('%') ||
    // eslint-disable-next-line no-control-regex -- path validation intentionally matches ASCII controls
    /[\u0000-\u001F\u007F:*?"<>|#]/.test(source) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/\.(?:png|jpe?g|webp|gif)$/i.test(source)
  ) {
    fail('invalid_image_path', path, 'Expected a workspace-relative PNG, JPEG, WebP, or GIF path')
  }
  return source
}

function parseElement(value: unknown, path: string): PresentationElement {
  const input = record(value, path)
  const type = enumValue(input.type, `${path}.type`, ['text', 'shape', 'image'])
  const common = ['id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'opacity']
  const base = parseElementBase(input, path)
  if (type === 'text') {
    exactKeysWithOptional(
      input,
      [...common, 'text', 'fontSize', 'fontWeight', 'color', 'align', 'verticalAlign'],
      ['fontFamily'],
      path
    )
    return {
      ...base,
      type,
      text: stringValue(input.text, `${path}.text`, 4_000),
      fontSize: numberValue(input.fontSize, `${path}.fontSize`, 8, 240),
      fontWeight: fontWeightValue(input.fontWeight, `${path}.fontWeight`),
      ...('fontFamily' in input
        ? {
            fontFamily: enumValue(
              input.fontFamily,
              `${path}.fontFamily`,
              ['sans', 'serif', 'mono'] as const
            )
          }
        : {}),
      color: colorValue(input.color, `${path}.color`),
      align: enumValue(input.align, `${path}.align`, ['left', 'center', 'right'] as const),
      verticalAlign: enumValue(input.verticalAlign, `${path}.verticalAlign`, ['top', 'middle', 'bottom'] as const)
    }
  }
  if (type === 'shape') {
    exactKeys(input, [...common, 'shape', 'fillColor', 'strokeColor', 'strokeWidth', 'cornerRadius'], path)
    return {
      ...base,
      type,
      shape: enumValue(input.shape, `${path}.shape`, ['rectangle', 'ellipse', 'line'] as const),
      fillColor: colorValue(input.fillColor, `${path}.fillColor`),
      strokeColor: colorValue(input.strokeColor, `${path}.strokeColor`),
      strokeWidth: numberValue(input.strokeWidth, `${path}.strokeWidth`, 0, 32),
      cornerRadius: numberValue(input.cornerRadius, `${path}.cornerRadius`, 0, 100)
    }
  }
  exactKeys(input, [...common, 'src', 'alt', 'fit'], path)
  return {
    ...base,
    type,
    src: imagePathValue(input.src, `${path}.src`),
    alt: stringValue(input.alt, `${path}.alt`, 500),
    fit: enumValue(input.fit, `${path}.fit`, ['contain', 'cover'] as const)
  }
}

function parseSlide(value: unknown, path: string): PresentationSlide {
  const input = record(value, path)
  exactKeysWithOptional(input, ['id', 'title', 'elements'], ['backgroundColor'], path)
  if (!Array.isArray(input.elements)) fail('invalid_type', `${path}.elements`, 'Expected an array')
  if (input.elements.length > MAX_ELEMENTS_PER_SLIDE) {
    fail('too_many_elements', `${path}.elements`, `At most ${MAX_ELEMENTS_PER_SLIDE} elements are allowed`)
  }
  return {
    id: idValue(input.id, `${path}.id`),
    title: stringValue(input.title, `${path}.title`, 120, true),
    backgroundColor: input.backgroundColor === undefined || input.backgroundColor === null
      ? null
      : colorValue(input.backgroundColor, `${path}.backgroundColor`),
    elements: input.elements.map((element, index) => parseElement(element, `${path}.elements[${index}]`))
  }
}

function parseReceipt(value: unknown, path: string): PresentationOperationReceipt {
  const input = record(value, path)
  exactKeys(input, ['operationId', 'digest', 'resultingRevision'], path)
  const digest = stringValue(input.digest, `${path}.digest`, 64)
  if (!/^[0-9a-f]{64}$/.test(digest)) fail('invalid_digest', `${path}.digest`, 'Expected a SHA-256 hex digest')
  return {
    operationId: stringValue(input.operationId, `${path}.operationId`, 128, true),
    digest,
    resultingRevision: integerValue(input.resultingRevision, `${path}.resultingRevision`, 1, Number.MAX_SAFE_INTEGER)
  }
}

export function normalizePresentationProject(value: unknown): PresentationProject {
  const input = record(value, '$')
  exactKeys(input, ['schemaVersion', 'id', 'revision', 'title', 'theme', 'slides', 'operationReceipts'], '$')
  if (input.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
    fail('unsupported_schema', '$.schemaVersion', `Only schema version ${PRESENTATION_SCHEMA_VERSION} is supported`)
  }
  if (!Array.isArray(input.slides)) fail('invalid_type', '$.slides', 'Expected an array')
  if (input.slides.length < 1 || input.slides.length > MAX_PRESENTATION_SLIDES) {
    fail('invalid_slide_count', '$.slides', `Expected 1 to ${MAX_PRESENTATION_SLIDES} slides`)
  }
  if (!Array.isArray(input.operationReceipts)) {
    fail('invalid_type', '$.operationReceipts', 'Expected an array')
  }
  if (input.operationReceipts.length > MAX_OPERATION_RECEIPTS) {
    fail('too_many_receipts', '$.operationReceipts', `At most ${MAX_OPERATION_RECEIPTS} receipts are allowed`)
  }
  const project: PresentationProject = {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    id: idValue(input.id, '$.id'),
    revision: integerValue(input.revision, '$.revision', 1, Number.MAX_SAFE_INTEGER),
    title: stringValue(input.title, '$.title', 160, true),
    theme: parseTheme(input.theme, '$.theme'),
    slides: input.slides.map((slide, index) => parseSlide(slide, `$.slides[${index}]`)),
    operationReceipts: input.operationReceipts.map((receipt, index) =>
      parseReceipt(receipt, `$.operationReceipts[${index}]`)
    )
  }
  const ids = new Set<string>([project.id])
  let elementCount = 0
  for (const slide of project.slides) {
    if (ids.has(slide.id)) fail('duplicate_id', '$.slides', `Duplicate ID: ${slide.id}`)
    ids.add(slide.id)
    for (const element of slide.elements) {
      elementCount += 1
      if (ids.has(element.id)) fail('duplicate_id', '$.slides', `Duplicate ID: ${element.id}`)
      ids.add(element.id)
    }
  }
  if (elementCount > MAX_PRESENTATION_ELEMENTS) {
    fail('too_many_elements', '$.slides', `At most ${MAX_PRESENTATION_ELEMENTS} elements are allowed`)
  }
  const receiptIds = new Set<string>()
  for (const receipt of project.operationReceipts) {
    if (receiptIds.has(receipt.operationId)) {
      fail('duplicate_operation_id', '$.operationReceipts', `Duplicate operation ID: ${receipt.operationId}`)
    }
    if (receipt.resultingRevision > project.revision) {
      fail('future_receipt', '$.operationReceipts', 'Receipt revision cannot exceed the project revision')
    }
    receiptIds.add(receipt.operationId)
  }
  if (new TextEncoder().encode(stableStringify(project)).byteLength > MAX_PRESENTATION_JSON_BYTES) {
    fail('model_too_large', '$', `Canonical JSON exceeds ${MAX_PRESENTATION_JSON_BYTES} bytes`)
  }
  return project
}

export function parsePresentationProject(value: string | unknown): PresentationProject {
  let parsed = value
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).byteLength > MAX_PRESENTATION_HTML_BYTES) {
      fail('model_too_large', '$', `Encoded JSON exceeds ${MAX_PRESENTATION_HTML_BYTES} bytes`)
    }
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      fail('invalid_json', '$', 'Presentation JSON is invalid')
    }
  }
  return normalizePresentationProject(parsed)
}

export const parsePresentationModel = parsePresentationProject
export const normalizePresentationModel = normalizePresentationProject

function collectWarnings(project: PresentationProject): PresentationValidationIssue[] {
  const warnings: PresentationValidationIssue[] = []
  project.slides.forEach((slide, slideIndex) => {
    if (slide.elements.length === 0) {
      warnings.push(issue('empty_slide', `$.slides[${slideIndex}]`, 'Slide has no elements'))
    }
    slide.elements.forEach((element, elementIndex) => {
      const path = `$.slides[${slideIndex}].elements[${elementIndex}]`
      if (element.type === 'image' && element.alt.trim().length === 0) {
        warnings.push(issue('missing_alt_text', `${path}.alt`, 'Image has no alternative text'))
      }
      if (element.type === 'shape' && element.shape === 'line' && element.fillColor !== element.strokeColor) {
        warnings.push(issue('unused_line_fill', `${path}.fillColor`, 'Line shapes ignore fill color'))
      }
    })
  })
  return warnings
}

export function validatePresentationProject(value: unknown): PresentationValidationResult {
  try {
    const project = normalizePresentationProject(value)
    return { ok: true, errors: [], warnings: collectWarnings(project), project }
  } catch (error) {
    if (error instanceof PresentationParseError) {
      return { ok: false, errors: error.issues, warnings: [] }
    }
    return { ok: false, errors: [issue('invalid_model', '$', 'Presentation model is invalid')], warnings: [] }
  }
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Stable JSON does not support non-finite numbers')
    return value
  }
  if (typeof value !== 'object') throw new TypeError('Stable JSON supports only JSON values')
  if (seen.has(value)) throw new TypeError('Stable JSON does not support cyclic objects')
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map((entry) => canonicalize(entry, seen))
    seen.delete(value)
    return result
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as JsonRecord).sort()) {
    const entry = (value as JsonRecord)[key]
    if (entry === undefined) throw new TypeError('Stable JSON does not support undefined')
    result[key] = canonicalize(entry, seen)
  }
  seen.delete(value)
  return result
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()))
}

export function serializePresentationProject(project: PresentationProject): string {
  return stableStringify(normalizePresentationProject(project))
}

export const serializePresentationModel = serializePresentationProject

export async function digestStableValue(value: unknown): Promise<string> {
  return digestUtf8Text(stableStringify(value))
}

export async function digestUtf8Text(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto is unavailable')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function digestPresentation(project: PresentationProject): Promise<string> {
  return digestStableValue(normalizePresentationProject(project))
}

function parseDocumentPatch(value: unknown, path: string): PresentationDocumentPatch {
  const input = record(value, path)
  exactKeysWithOptional(input, [], ['title', 'theme'], path)
  if (Object.keys(input).length === 0) fail('empty_patch', path, 'Patch must change at least one field')
  const patch: PresentationDocumentPatch = {}
  if ('title' in input) patch.title = stringValue(input.title, `${path}.title`, 160, true)
  if ('theme' in input) {
    const theme = record(input.theme, `${path}.theme`)
    exactKeysWithOptional(
      theme,
      [],
      ['backgroundColor', 'textColor', 'accentColor', 'fontFamily'],
      `${path}.theme`
    )
    if (Object.keys(theme).length === 0) fail('empty_patch', `${path}.theme`, 'Theme patch is empty')
    patch.theme = {}
    if ('backgroundColor' in theme) {
      patch.theme.backgroundColor = colorValue(theme.backgroundColor, `${path}.theme.backgroundColor`)
    }
    if ('textColor' in theme) patch.theme.textColor = colorValue(theme.textColor, `${path}.theme.textColor`)
    if ('accentColor' in theme) patch.theme.accentColor = colorValue(theme.accentColor, `${path}.theme.accentColor`)
    if ('fontFamily' in theme) {
      patch.theme.fontFamily = enumValue(
        theme.fontFamily,
        `${path}.theme.fontFamily`,
        ['sans', 'serif', 'mono'] as const
      )
    }
  }
  return patch
}

function parseSlidePatch(value: unknown, path: string): PresentationSlidePatch {
  const input = record(value, path)
  exactKeysWithOptional(input, [], ['title', 'backgroundColor'], path)
  if (Object.keys(input).length === 0) fail('empty_patch', path, 'Patch must change at least one field')
  const patch: PresentationSlidePatch = {}
  if ('title' in input) patch.title = stringValue(input.title, `${path}.title`, 120, true)
  if ('backgroundColor' in input) {
    patch.backgroundColor = input.backgroundColor === null
      ? null
      : colorValue(input.backgroundColor, `${path}.backgroundColor`)
  }
  return patch
}

function optionalIndexProperty(
  input: JsonRecord,
  key: string,
  path: string
): { index: number } | Record<string, never> {
  return key in input
    ? { index: integerValue(input[key], `${path}.${key}`, 0, MAX_PRESENTATION_ELEMENTS) }
    : {}
}

function parseOperation(value: unknown, path: string): PresentationOperation {
  const input = record(value, path)
  const kind = enumValue(input.kind, `${path}.kind`, [
    'document.update',
    'slide.insert',
    'slide.update',
    'slide.delete',
    'slide.reorder',
    'element.upsert',
    'element.style',
    'element.delete'
  ])
  switch (kind) {
    case 'document.update':
      exactKeys(input, ['kind', 'patch'], path)
      return { kind, patch: parseDocumentPatch(input.patch, `${path}.patch`) }
    case 'slide.insert':
      exactKeysWithOptional(input, ['kind', 'slide'], ['index'], path)
      return {
        kind,
        slide: parseSlide(input.slide, `${path}.slide`),
        ...optionalIndexProperty(input, 'index', path)
      }
    case 'slide.update':
      exactKeys(input, ['kind', 'slideId', 'patch'], path)
      return {
        kind,
        slideId: idValue(input.slideId, `${path}.slideId`),
        patch: parseSlidePatch(input.patch, `${path}.patch`)
      }
    case 'slide.delete':
      exactKeys(input, ['kind', 'slideId'], path)
      return { kind, slideId: idValue(input.slideId, `${path}.slideId`) }
    case 'slide.reorder':
      exactKeys(input, ['kind', 'slideId', 'index'], path)
      return {
        kind,
        slideId: idValue(input.slideId, `${path}.slideId`),
        index: integerValue(input.index, `${path}.index`, 0, MAX_PRESENTATION_SLIDES - 1)
      }
    case 'element.upsert':
      exactKeysWithOptional(input, ['kind', 'slideId', 'element'], ['index'], path)
      return {
        kind,
        slideId: idValue(input.slideId, `${path}.slideId`),
        element: parseElement(input.element, `${path}.element`),
        ...optionalIndexProperty(input, 'index', path)
      }
    case 'element.style':
      exactKeys(input, ['kind', 'slideId', 'elementId', 'css'], path)
      return {
        kind,
        slideId: idValue(input.slideId, `${path}.slideId`),
        elementId: idValue(input.elementId, `${path}.elementId`),
        css: stringValue(input.css, `${path}.css`, MAX_EDITABLE_CSS_LENGTH, true)
      }
    case 'element.delete':
      exactKeys(input, ['kind', 'slideId', 'elementId'], path)
      return {
        kind,
        slideId: idValue(input.slideId, `${path}.slideId`),
        elementId: idValue(input.elementId, `${path}.elementId`)
      }
  }
}

export function parsePresentationOperations(value: unknown): PresentationOperation[] {
  if (!Array.isArray(value)) fail('invalid_type', '$operations', 'Expected an operation array')
  if (value.length < 1 || value.length > MAX_PRESENTATION_OPERATIONS) {
    fail(
      'invalid_operation_count',
      '$operations',
      `Expected 1 to ${MAX_PRESENTATION_OPERATIONS} operations`
    )
  }
  return value.map((operation, index) => parseOperation(operation, `$operations[${index}]`))
}

function findSlide(project: PresentationProject, slideId: string, operationIndex: number): PresentationSlide {
  const slide = project.slides.find((candidate) => candidate.id === slideId)
  if (!slide) throw new PresentationOperationError(`Slide not found: ${slideId}`, operationIndex)
  return slide
}

function addChanged(changedIds: string[], ...ids: string[]): void {
  for (const id of ids) if (!changedIds.includes(id)) changedIds.push(id)
}

export function applyPresentationOperations(
  source: PresentationProject,
  inputOperations: readonly PresentationOperation[]
): ApplyPresentationOperationsResult {
  const operations = parsePresentationOperations(inputOperations)
  let project = normalizePresentationProject(source)
  const changedIds: string[] = []
  const inverseOperations: PresentationOperation[] = []

  operations.forEach((operation, operationIndex) => {
    try {
      switch (operation.kind) {
        case 'document.update': {
          const inversePatch: PresentationDocumentPatch = {}
          if (operation.patch.title !== undefined) {
            inversePatch.title = project.title
            project.title = operation.patch.title
          }
          if (operation.patch.theme !== undefined) {
            inversePatch.theme = {}
            for (const key of Object.keys(operation.patch.theme) as Array<keyof PresentationTheme>) {
              ;(inversePatch.theme as Record<string, unknown>)[key] = project.theme[key]
            }
            project.theme = { ...project.theme, ...operation.patch.theme }
          }
          inverseOperations.unshift({ kind: 'document.update', patch: inversePatch })
          addChanged(changedIds, project.id)
          break
        }
        case 'slide.insert': {
          const index = operation.index ?? project.slides.length
          if (index > project.slides.length) {
            throw new PresentationOperationError('Slide insert index is out of range', operationIndex)
          }
          project.slides.splice(index, 0, operation.slide)
          inverseOperations.unshift({ kind: 'slide.delete', slideId: operation.slide.id })
          addChanged(changedIds, operation.slide.id, ...operation.slide.elements.map((element) => element.id))
          break
        }
        case 'slide.update': {
          const slide = findSlide(project, operation.slideId, operationIndex)
          const inversePatch: PresentationSlidePatch = {}
          if (operation.patch.title !== undefined) {
            inversePatch.title = slide.title
            slide.title = operation.patch.title
          }
          if (operation.patch.backgroundColor !== undefined) {
            inversePatch.backgroundColor = slide.backgroundColor
            slide.backgroundColor = operation.patch.backgroundColor
          }
          inverseOperations.unshift({ kind: 'slide.update', slideId: slide.id, patch: inversePatch })
          addChanged(changedIds, slide.id)
          break
        }
        case 'slide.delete': {
          if (project.slides.length === 1) {
            throw new PresentationOperationError('Cannot delete the last slide', operationIndex)
          }
          const index = project.slides.findIndex((slide) => slide.id === operation.slideId)
          if (index < 0) throw new PresentationOperationError(`Slide not found: ${operation.slideId}`, operationIndex)
          const [slide] = project.slides.splice(index, 1)
          inverseOperations.unshift({ kind: 'slide.insert', slide, index })
          addChanged(changedIds, slide.id, ...slide.elements.map((element) => element.id))
          break
        }
        case 'slide.reorder': {
          const index = project.slides.findIndex((slide) => slide.id === operation.slideId)
          if (index < 0) throw new PresentationOperationError(`Slide not found: ${operation.slideId}`, operationIndex)
          if (operation.index >= project.slides.length) {
            throw new PresentationOperationError('Slide reorder index is out of range', operationIndex)
          }
          const [slide] = project.slides.splice(index, 1)
          project.slides.splice(operation.index, 0, slide)
          inverseOperations.unshift({ kind: 'slide.reorder', slideId: slide.id, index })
          addChanged(changedIds, slide.id)
          break
        }
        case 'element.upsert': {
          const slide = findSlide(project, operation.slideId, operationIndex)
          const previousIndex = slide.elements.findIndex((element) => element.id === operation.element.id)
          if (previousIndex >= 0) {
            const previous = slide.elements[previousIndex]
            slide.elements.splice(previousIndex, 1)
            const index = operation.index ?? previousIndex
            if (index > slide.elements.length) {
              throw new PresentationOperationError('Element upsert index is out of range', operationIndex)
            }
            slide.elements.splice(index, 0, operation.element)
            inverseOperations.unshift({
              kind: 'element.upsert',
              slideId: slide.id,
              element: previous,
              index: previousIndex
            })
          } else {
            const index = operation.index ?? slide.elements.length
            if (index > slide.elements.length) {
              throw new PresentationOperationError('Element insert index is out of range', operationIndex)
            }
            slide.elements.splice(index, 0, operation.element)
            inverseOperations.unshift({ kind: 'element.delete', slideId: slide.id, elementId: operation.element.id })
          }
          addChanged(changedIds, slide.id, operation.element.id)
          break
        }
        case 'element.style': {
          const slide = findSlide(project, operation.slideId, operationIndex)
          const index = slide.elements.findIndex((element) => element.id === operation.elementId)
          if (index < 0) {
            throw new PresentationOperationError(`Element not found: ${operation.elementId}`, operationIndex)
          }
          const previous = slide.elements[index]!
          const styled = applyEditableElementCss(previous, operation.css)
          slide.elements.splice(index, 1, styled)
          inverseOperations.unshift({
            kind: 'element.upsert',
            slideId: slide.id,
            element: previous,
            index
          })
          addChanged(changedIds, slide.id, styled.id)
          break
        }
        case 'element.delete': {
          const slide = findSlide(project, operation.slideId, operationIndex)
          const index = slide.elements.findIndex((element) => element.id === operation.elementId)
          if (index < 0) {
            throw new PresentationOperationError(`Element not found: ${operation.elementId}`, operationIndex)
          }
          const [element] = slide.elements.splice(index, 1)
          inverseOperations.unshift({ kind: 'element.upsert', slideId: slide.id, element, index })
          addChanged(changedIds, slide.id, element.id)
          break
        }
      }
      project = normalizePresentationProject(project)
    } catch (error) {
      if (error instanceof PresentationOperationError) throw error
      const message = error instanceof Error ? error.message : 'Operation is invalid'
      throw new PresentationOperationError(message, operationIndex)
    }
  })

  return {
    project,
    changedIds,
    inverseOperations,
    warnings: collectWarnings(project)
  }
}

const MODEL_MARKER_START = '<script id="kun-presentation-model" type="application/json">'
const MODEL_MARKER_END = '</script>'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeEmbeddedJson(value: string): string {
  return value
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003C')
    .replaceAll('>', '\\u003E')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function cssNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

function fontStack(font: PresentationFontFamily): string {
  if (font === 'serif') return 'Georgia,Times New Roman,serif'
  if (font === 'mono') return 'SFMono-Regular,Consolas,Liberation Mono,monospace'
  return 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
}

function elementCss(element: PresentationElement, className: string, index: number): string {
  const declarations = [
    `left:${cssNumber(element.x)}%`,
    `top:${cssNumber(element.y)}%`,
    `width:${cssNumber(element.width)}%`,
    `height:${cssNumber(element.height)}%`,
    `opacity:${cssNumber(element.opacity)}`,
    `transform:rotate(${cssNumber(element.rotation)}deg)`,
    `z-index:${index + 1}`
  ]
  if (element.type === 'text') {
    declarations.push(
      `color:${element.color}`,
      `font-size:${cssNumber(element.fontSize / 16)}cqw`,
      `font-weight:${element.fontWeight}`,
      ...(element.fontFamily ? [`font-family:${fontStack(element.fontFamily)}`] : []),
      `text-align:${element.align}`,
      `justify-content:${element.verticalAlign === 'top' ? 'flex-start' : element.verticalAlign === 'bottom' ? 'flex-end' : 'center'}`
    )
  } else if (element.type === 'shape') {
    if (element.shape === 'line') {
      declarations.push(
        'background:transparent',
        `border-top:${cssNumber(Math.max(1, element.strokeWidth))}px solid ${element.strokeColor}`
      )
    } else {
      declarations.push(
        `background:${element.fillColor}`,
        `border:${cssNumber(element.strokeWidth)}px solid ${element.strokeColor}`,
        `border-radius:${element.shape === 'ellipse' ? '50%' : `${cssNumber(element.cornerRadius)}px`}`
      )
    }
  } else {
    declarations.push(`object-fit:${element.fit}`)
  }
  return `.${className}{${declarations.join(';')}}`
}

function renderElement(
  element: PresentationElement,
  className: string,
  slideId: string
): string {
  const attributes = `class="kun-element ${className} kun-${element.type}" data-kun-slide-id="${escapeHtml(slideId)}" data-kun-element-id="${escapeHtml(element.id)}"`
  if (element.type === 'text') return `<div ${attributes}>${escapeHtml(element.text)}</div>`
  if (element.type === 'shape') {
    return `<div ${attributes} role="img" aria-label="${escapeHtml(`${element.shape} shape`)}"></div>`
  }
  return `<img ${attributes} src="${escapeHtml(element.src)}" alt="${escapeHtml(element.alt)}">`
}

export function serializePresentationHtml(value: PresentationProject): string {
  const project = normalizePresentationProject(value)
  const dynamicCss: string[] = []
  const slides = project.slides.map((slide, slideIndex) => {
    const slideClass = `kun-slide-${slideIndex}`
    dynamicCss.push(`.${slideClass}{background:${slide.backgroundColor ?? project.theme.backgroundColor}}`)
    const elements = slide.elements.map((element, elementIndex) => {
      const className = `kun-element-${slideIndex}-${elementIndex}`
      dynamicCss.push(elementCss(element, className, elementIndex))
      return renderElement(element, className, slide.id)
    }).join('\n')
    return `<section class="kun-slide ${slideClass}" data-kun-slide-id="${escapeHtml(slide.id)}" aria-label="${escapeHtml(slide.title)}">
${elements}
</section>`
  }).join('\n')
  const embeddedJson = escapeEmbeddedJson(stableStringify(project))
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: file:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'">
<title>${escapeHtml(project.title)}</title>
${MODEL_MARKER_START}${embeddedJson}${MODEL_MARKER_END}
<style>
:root{color-scheme:dark;font-family:${fontStack(project.theme.fontFamily)};background:#0B0F19}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#0B0F19}
.kun-deck{display:grid;gap:5vh;justify-items:center;padding:5vh 3vw;scroll-snap-type:y mandatory}
.kun-slide{position:relative;container-type:inline-size;width:min(94vw,calc(90vh * 16 / 9));aspect-ratio:16/9;overflow:hidden;scroll-snap-align:center;box-shadow:0 1rem 3rem #0008}
.kun-element{position:absolute;margin:0;box-sizing:border-box;overflow:hidden}
.kun-text{display:flex;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.15}
.kun-image{display:block}
${dynamicCss.join('\n')}
@media print{@page{size:13.333in 7.5in;margin:0}html,body{background:#fff}.kun-deck{display:block;padding:0}.kun-slide{width:13.333in;height:7.5in;break-after:page;box-shadow:none}.kun-slide:last-child{break-after:auto}}
</style>
</head>
<body>
<main class="kun-deck" data-kun-presentation-id="${escapeHtml(project.id)}">
${slides}
</main>
</body>
</html>
`
  if (new TextEncoder().encode(html).byteLength > MAX_PRESENTATION_HTML_BYTES) {
    throw new PresentationParseError(`Rendered HTML exceeds ${MAX_PRESENTATION_HTML_BYTES} bytes`, [
      issue('html_too_large', '$', `Rendered HTML exceeds ${MAX_PRESENTATION_HTML_BYTES} bytes`)
    ])
  }
  return html
}

export const renderStandalonePresentation = serializePresentationHtml

export function parsePresentationHtml(html: string): PresentationProject {
  if (typeof html !== 'string') fail('invalid_type', '$html', 'Expected an HTML string')
  if (new TextEncoder().encode(html).byteLength > MAX_PRESENTATION_HTML_BYTES) {
    fail('html_too_large', '$html', `HTML exceeds ${MAX_PRESENTATION_HTML_BYTES} bytes`)
  }
  const start = html.indexOf(MODEL_MARKER_START)
  if (start < 0) fail('missing_model_marker', '$html', 'Presentation model marker is missing')
  if (html.indexOf(MODEL_MARKER_START, start + MODEL_MARKER_START.length) >= 0) {
    fail('duplicate_model_marker', '$html', 'Presentation contains multiple model markers')
  }
  const jsonStart = start + MODEL_MARKER_START.length
  const end = html.indexOf(MODEL_MARKER_END, jsonStart)
  if (end < 0) fail('unterminated_model_marker', '$html', 'Presentation model marker is not closed')
  return parsePresentationProject(html.slice(jsonStart, end))
}

export const extractPresentationFromHtml = parsePresentationHtml
