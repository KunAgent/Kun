import type {
  PresentationElement,
  PresentationImageElement,
  PresentationShapeElement,
  PresentationTextElement
} from './presentation.js'

export const MAX_EDITABLE_CSS_LENGTH = 2_000
const NUMBER_PATTERN = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)'

const COMMON_PROPERTIES = [
  'position',
  'left',
  'top',
  'width',
  'height',
  'opacity',
  'transform'
] as const

const TYPE_PROPERTIES = {
  text: ['color', 'font-size', 'font-weight', 'font-family', 'text-align', 'justify-content'],
  shape: ['background-color', 'border-color', 'border-width', 'border-radius'],
  image: ['object-fit']
} as const

export class PresentationCssEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresentationCssEditError'
  }
}

function cssNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

function declarationsForText(element: PresentationTextElement): string[] {
  return [
    `color: ${element.color}`,
    `font-size: ${cssNumber(element.fontSize)}px`,
    `font-weight: ${element.fontWeight}`,
    `font-family: ${element.fontFamily ?? 'inherit'}`,
    `text-align: ${element.align}`,
    `justify-content: ${element.verticalAlign === 'top'
      ? 'flex-start'
      : element.verticalAlign === 'bottom' ? 'flex-end' : 'center'}`
  ]
}

function declarationsForShape(element: PresentationShapeElement): string[] {
  return [
    `background-color: ${element.fillColor}`,
    `border-color: ${element.strokeColor}`,
    `border-width: ${cssNumber(element.strokeWidth)}px`,
    `border-radius: ${element.shape === 'ellipse' ? '50%' : `${cssNumber(element.cornerRadius)}px`}`
  ]
}

function declarationsForImage(element: PresentationImageElement): string[] {
  return [`object-fit: ${element.fit}`]
}

export function editableCssPropertiesForElement(element: PresentationElement): string[] {
  return [...COMMON_PROPERTIES, ...TYPE_PROPERTIES[element.type]]
}

export function serializeEditableElementCss(element: PresentationElement): string {
  const declarations = [
    'position: absolute',
    `left: ${cssNumber(element.x)}%`,
    `top: ${cssNumber(element.y)}%`,
    `width: ${cssNumber(element.width)}%`,
    `height: ${cssNumber(element.height)}%`,
    `opacity: ${cssNumber(element.opacity)}`,
    `transform: rotate(${cssNumber(element.rotation)}deg)`,
    ...(element.type === 'text'
      ? declarationsForText(element)
      : element.type === 'shape'
        ? declarationsForShape(element)
        : declarationsForImage(element))
  ]
  return declarations.map((declaration) => `${declaration};`).join('\n')
}

function parseDeclarations(source: string): Map<string, string> {
  if (typeof source !== 'string' || source.length > MAX_EDITABLE_CSS_LENGTH) {
    throw new PresentationCssEditError(`CSS declarations must be at most ${MAX_EDITABLE_CSS_LENGTH} characters.`)
  }
  if (/[{}@]/u.test(source) || source.includes('/*') || source.includes('*/')) {
    throw new PresentationCssEditError('Selectors, at-rules, comments, and declaration blocks are not allowed.')
  }
  // eslint-disable-next-line no-control-regex -- CSS editor rejects non-whitespace ASCII controls
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(source)) {
    throw new PresentationCssEditError('CSS declarations contain an unsupported control character.')
  }
  const declarations = new Map<string, string>()
  for (const raw of source.split(';')) {
    const declaration = raw.trim()
    if (!declaration) continue
    const separator = declaration.indexOf(':')
    if (separator <= 0 || declaration.indexOf(':', separator + 1) >= 0) {
      throw new PresentationCssEditError(`Invalid CSS declaration: ${declaration.slice(0, 80)}`)
    }
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const value = declaration.slice(separator + 1).trim()
    if (!/^[a-z-]+$/u.test(property) || !value) {
      throw new PresentationCssEditError(`Invalid CSS declaration: ${declaration.slice(0, 80)}`)
    }
    if (declarations.has(property)) {
      throw new PresentationCssEditError(`Duplicate CSS property: ${property}`)
    }
    declarations.set(property, value)
  }
  if (declarations.size === 0) {
    throw new PresentationCssEditError('Enter at least one CSS declaration.')
  }
  return declarations
}

function boundedNumber(value: string, property: string, min: number, max: number): number {
  if (!new RegExp(`^${NUMBER_PATTERN}$`, 'u').test(value)) {
    throw new PresentationCssEditError(`${property} must be a number between ${min} and ${max}.`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new PresentationCssEditError(`${property} must be between ${min} and ${max}.`)
  }
  return Math.round(parsed * 10_000) / 10_000
}

function boundedUnit(
  value: string,
  property: string,
  unit: '%' | 'px',
  min: number,
  max: number
): number {
  const match = new RegExp(`^(${NUMBER_PATTERN})${unit === '%' ? '%' : 'px'}$`, 'iu').exec(value)
  if (!match) throw new PresentationCssEditError(`${property} must use ${unit} units.`)
  return boundedNumber(match[1]!, property, min, max)
}

function color(value: string, property: string): string {
  if (!/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new PresentationCssEditError(`${property} must be a #RRGGBB color.`)
  }
  return value.toUpperCase()
}

function oneOf<T extends string>(value: string, property: string, choices: readonly T[]): T {
  const normalized = value.toLowerCase()
  if (!choices.includes(normalized as T)) {
    throw new PresentationCssEditError(`${property} must be one of: ${choices.join(', ')}.`)
  }
  return normalized as T
}

function requireText(element: PresentationElement, property: string): PresentationTextElement {
  if (element.type !== 'text') throw new PresentationCssEditError(`${property} is only available for text DIVs.`)
  return element
}

function requireShape(element: PresentationElement, property: string): PresentationShapeElement {
  if (element.type !== 'shape') throw new PresentationCssEditError(`${property} is only available for shape DIVs.`)
  return element
}

function requireImage(element: PresentationElement, property: string): PresentationImageElement {
  if (element.type !== 'image') throw new PresentationCssEditError(`${property} is only available for images.`)
  return element
}

export function applyEditableElementCss(
  element: PresentationElement,
  source: string
): PresentationElement {
  const declarations = parseDeclarations(source)
  const allowed = new Set(editableCssPropertiesForElement(element))
  let next = structuredClone(element)

  for (const [property, value] of declarations) {
    if (!allowed.has(property)) {
      throw new PresentationCssEditError(
        `Unsupported CSS property for this ${element.type} element: ${property}`
      )
    }
    switch (property) {
      case 'position':
        if (value.toLowerCase() !== 'absolute') {
          throw new PresentationCssEditError('position is fixed to absolute inside the slide canvas.')
        }
        break
      case 'left':
        next = { ...next, x: boundedUnit(value, property, '%', 0, 100) }
        break
      case 'top':
        next = { ...next, y: boundedUnit(value, property, '%', 0, 100) }
        break
      case 'width':
        next = { ...next, width: boundedUnit(value, property, '%', 0.1, 100) }
        break
      case 'height':
        next = { ...next, height: boundedUnit(value, property, '%', 0.1, 100) }
        break
      case 'opacity':
        next = { ...next, opacity: boundedNumber(value, property, 0, 1) }
        break
      case 'transform': {
        if (value.toLowerCase() === 'none') {
          next = { ...next, rotation: 0 }
          break
        }
        const match = new RegExp(`^rotate\\((${NUMBER_PATTERN})deg\\)$`, 'iu').exec(value)
        if (!match) throw new PresentationCssEditError('transform supports only rotate(<number>deg) or none.')
        next = { ...next, rotation: boundedNumber(match[1]!, property, -180, 180) }
        break
      }
      case 'color': {
        const text = requireText(next, property)
        next = { ...text, color: color(value, property) }
        break
      }
      case 'font-size': {
        const text = requireText(next, property)
        next = { ...text, fontSize: boundedUnit(value, property, 'px', 8, 240) }
        break
      }
      case 'font-weight': {
        const text = requireText(next, property)
        const weight = boundedNumber(value, property, 400, 700)
        if (weight !== 400 && weight !== 500 && weight !== 600 && weight !== 700) {
          throw new PresentationCssEditError('font-weight must be 400, 500, 600, or 700.')
        }
        next = { ...text, fontWeight: weight }
        break
      }
      case 'font-family': {
        const text = requireText(next, property)
        const family = oneOf(value, property, ['inherit', 'sans', 'serif', 'mono'] as const)
        if (family === 'inherit') {
          const { fontFamily: _fontFamily, ...withoutFontFamily } = text
          next = withoutFontFamily
        } else {
          next = { ...text, fontFamily: family }
        }
        break
      }
      case 'text-align': {
        const text = requireText(next, property)
        next = { ...text, align: oneOf(value, property, ['left', 'center', 'right'] as const) }
        break
      }
      case 'justify-content': {
        const text = requireText(next, property)
        const alignment = oneOf(value, property, ['flex-start', 'center', 'flex-end'] as const)
        next = {
          ...text,
          verticalAlign: alignment === 'flex-start' ? 'top' : alignment === 'flex-end' ? 'bottom' : 'middle'
        }
        break
      }
      case 'background-color': {
        const shape = requireShape(next, property)
        next = { ...shape, fillColor: color(value, property) }
        break
      }
      case 'border-color': {
        const shape = requireShape(next, property)
        next = { ...shape, strokeColor: color(value, property) }
        break
      }
      case 'border-width': {
        const shape = requireShape(next, property)
        next = { ...shape, strokeWidth: boundedUnit(value, property, 'px', 0, 32) }
        break
      }
      case 'border-radius': {
        const shape = requireShape(next, property)
        if (shape.shape === 'ellipse' && value === '50%') break
        next = { ...shape, cornerRadius: boundedUnit(value, property, 'px', 0, 100) }
        break
      }
      case 'object-fit': {
        const image = requireImage(next, property)
        next = { ...image, fit: oneOf(value, property, ['contain', 'cover'] as const) }
        break
      }
    }
  }

  if (next.x + next.width > 100.0001 || next.y + next.height > 100.0001) {
    throw new PresentationCssEditError('The edited DIV must remain inside the 16:9 slide canvas.')
  }
  return next
}
