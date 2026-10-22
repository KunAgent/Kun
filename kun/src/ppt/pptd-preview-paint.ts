import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { asNumber, asRecord, asString, resolveTokenColor, splitColorAlpha, type PptdRect } from './pptd-deck.js'
import { detectPptImageDimensions } from './ppt-geometry-qa-image.js'
import { round } from './pptd-preview-geometry.js'
import { escapeXml } from './pptd-preview-text.js'

/** Per-image and per-page caps keep preview SVGs small enough for the whiteboard cache. */
export const PPTD_PREVIEW_MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const PPTD_PREVIEW_MAX_PAGE_IMAGE_BYTES = 24 * 1024 * 1024

const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

export type PptdPreviewImage = {
  href: string
  width?: number
  height?: number
}

export type PptdImageResolution =
  | { ok: true; image: PptdPreviewImage; relativePath: string }
  | { ok: false; reason: 'missing' | 'remote' | 'outside' | 'unsupported' | 'too-large' }

/** Where an embedded image sits on the page, in page pixels. */
export type PptdImagePlacement = { path: string; rect: PptdRect }

/** Mutable state shared by every element of one rendered page. */
export class PptdPaintContext {
  readonly defs: string[] = []
  readonly images: PptdImagePlacement[] = []
  private nextId = 0
  private imageBytes = 0

  constructor(
    readonly deckDir: string,
    readonly colors: Record<string, unknown>,
    readonly pagePrefix: string
  ) {}

  id(kind: string): string {
    this.nextId += 1
    return `${this.pagePrefix}-${kind}-${this.nextId}`
  }

  async image(src: string, placement: PptdRect): Promise<PptdImageResolution> {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return { ok: false, reason: 'remote' }
    const lexical = isAbsolute(src) ? src : resolve(this.deckDir, src)
    const mime = IMAGE_MIME[extname(lexical).toLowerCase()]
    if (!mime) return { ok: false, reason: 'unsupported' }
    let physical: string
    let root: string
    try {
      ;[physical, root] = await Promise.all([realpath(lexical), realpath(this.deckDir)])
    } catch {
      return { ok: false, reason: 'missing' }
    }
    const inside = relative(root, physical)
    // PPTD projects are self-contained; never embed bytes from outside the project.
    if (!inside || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('..')) {
      return { ok: false, reason: 'outside' }
    }
    const bytes = await readFile(physical).catch(() => undefined)
    if (!bytes) return { ok: false, reason: 'missing' }
    if (bytes.byteLength > PPTD_PREVIEW_MAX_IMAGE_BYTES ||
      this.imageBytes + bytes.byteLength > PPTD_PREVIEW_MAX_PAGE_IMAGE_BYTES) {
      return { ok: false, reason: 'too-large' }
    }
    this.imageBytes += bytes.byteLength
    const relativePath = relative(this.deckDir, lexical).split(sep).join('/')
    this.images.push({ path: relativePath, rect: placement })
    const dimensions = detectPptImageDimensions(bytes, lexical)
    return {
      ok: true,
      relativePath,
      image: {
        href: `data:${mime};base64,${bytes.toString('base64')}`,
        ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {})
      }
    }
  }
}

export function colorAttributes(raw: string | undefined, colors: Record<string, unknown>, prefix: 'fill' | 'stroke'): string | undefined {
  const resolved = resolveTokenColor(raw, colors)
  if (!resolved) return undefined
  const { color, opacity } = splitColorAlpha(resolved)
  if (!/^#[0-9A-F]{6}$/i.test(color)) return undefined
  return ` ${prefix}="${color}"${opacity < 1 ? ` ${prefix}-opacity="${opacity}"` : ''}`
}

function gradientDefinition(fill: Record<string, unknown>, context: PptdPaintContext): string | undefined {
  const stops = (Array.isArray(fill.stops) ? fill.stops : [])
    .map((stop) => asRecord(stop))
    .map((stop) => {
      const offset = asNumber(stop?.position) ?? asNumber(stop?.offset)
      const resolved = resolveTokenColor(stop?.color, context.colors)
      if (offset === undefined || !resolved) return undefined
      const { color, opacity } = splitColorAlpha(resolved)
      return /^#[0-9A-F]{6}$/i.test(color)
        ? `<stop offset="${round(Math.min(Math.max(offset, 0), 1))}" stop-color="${color}"${opacity < 1 ? ` stop-opacity="${opacity}"` : ''}/>`
        : undefined
    })
    .filter((stop): stop is string => stop !== undefined)
  if (stops.length < 2) return undefined
  const id = context.id('grad')
  const radial = asString(fill.gradientType) === 'radial' || asString(fill.type) === 'radial'
  if (radial) {
    context.defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops.join('')}</radialGradient>`)
  } else {
    const angle = ((asNumber(fill.angle) ?? 0) * Math.PI) / 180
    const dx = Math.cos(angle) / 2
    const dy = Math.sin(angle) / 2
    context.defs.push(`<linearGradient id="${id}" x1="${round(0.5 - dx)}" y1="${round(0.5 - dy)}" x2="${round(0.5 + dx)}" y2="${round(0.5 + dy)}">${stops.join('')}</linearGradient>`)
  }
  return ` fill="url(#${id})"`
}

/** Solid or gradient fill attributes; image fills are drawn separately by the caller. */
export function fillAttributes(value: unknown, context: PptdPaintContext): string {
  const fill = asRecord(value)
  const type = asString(fill?.type)
  if (!fill || !type || type === 'none') return ' fill="none"'
  if (type === 'solid') return colorAttributes(asString(fill.color), context.colors, 'fill') ?? ' fill="none"'
  if (type === 'gradient' || type === 'linear' || type === 'radial') return gradientDefinition(fill, context) ?? ' fill="none"'
  return ' fill="none"'
}

export function strokeAttributes(value: unknown, colors: Record<string, unknown>): string {
  const border = asRecord(value)
  if (!border) return ''
  const color = colorAttributes(asString(border.color) ?? '#000000', colors, 'stroke')
  const width = asNumber(border.width) ?? 1
  if (!color || width <= 0) return ''
  const style = asString(border.style)
  const dash = style === 'dashed' || style === 'dash'
    ? ` stroke-dasharray="${round(width * 4)} ${round(width * 2)}"`
    : style === 'dotted' || style === 'dot'
      ? ` stroke-dasharray="${round(width)} ${round(width * 1.6)}"`
      : ''
  return `${color} stroke-width="${round(width)}"${dash}`
}

export function preserveAspectRatio(fit: unknown): string {
  const mode = asString(asRecord(fit)?.mode)
  if (mode === 'fill') return 'none'
  if (mode === 'contain') return 'xMidYMid meet'
  return 'xMidYMid slice'
}

/**
 * Draw an image into `rect`, applying PPTD crop (source inset) before fit.
 * The nested <svg> viewBox selects the cropped source region.
 */
export function imageMarkup(image: PptdPreviewImage, rect: PptdRect, fit: unknown, crop: unknown, opacity?: number): string {
  const ratio = preserveAspectRatio(fit)
  const opacityAttr = opacity !== undefined && opacity < 1 ? ` opacity="${round(opacity)}"` : ''
  const href = escapeXml(image.href)
  const cropRecord = asRecord(crop)
  if (!image.width || !image.height) {
    return `<image x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" preserveAspectRatio="${ratio}" href="${href}"${opacityAttr}/>`
  }
  const left = asNumber(cropRecord?.left) ?? 0
  const top = asNumber(cropRecord?.top) ?? 0
  const right = asNumber(cropRecord?.right) ?? 0
  const bottom = asNumber(cropRecord?.bottom) ?? 0
  const sw = image.width * Math.max(1 - left - right, 0.01)
  const sh = image.height * Math.max(1 - top - bottom, 0.01)
  return `<svg x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" viewBox="${round(image.width * left)} ${round(image.height * top)} ${round(sw)} ${round(sh)}" preserveAspectRatio="${ratio}" overflow="hidden"${opacityAttr}><image width="${image.width}" height="${image.height}" href="${href}"/></svg>`
}

export function missingImageMarkup(rect: PptdRect, reason: string): string {
  const label = reason === 'remote' ? '外部图片' : reason === 'too-large' ? '图片过大' : '图片缺失'
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return [
    `<rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" fill="#EEF0F4" stroke="#C9CED6" stroke-dasharray="6 4"/>`,
    `<text x="${round(cx)}" y="${round(cy + 4)}" font-size="12" fill="#5F6672" text-anchor="middle" font-family="sans-serif">${label}</text>`
  ].join('')
}
