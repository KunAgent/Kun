import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { kunAvatarBodyClip, kunAvatarLayerKeys, kunAvatarScene, normalizeKunAvatarParts, type KunAvatarParts } from '@shared/rooms-api'
import { posterCopy, posterDisplayCode, posterLayout, posterQrContent, POSTER_THEMES, type PosterSize, type PosterStyle } from './share-poster-model'

export type PosterInput = { look: KunAvatarParts; style: PosterStyle; size: PosterSize; code: string; link: string; showCode: boolean; language: string }
export type PosterResources = { layerUrl: (key: string) => string | undefined; artUrl: (name: string) => string | undefined }
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
export async function loadPosterImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.decoding = 'async'
  // Hot-updated art has its own origin. Request CORS before src so the canvas
  // remains exportable, matching the wardrobe avatar compositor.
  if (url.startsWith('kun-asset:')) image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { image.src = ''; reject(new Error('image-timeout')) }, 15000)
    image.onload = () => { clearTimeout(timeout); resolve() }
    image.onerror = () => { clearTimeout(timeout); reject(new Error('image-load')) }
    image.src = url
  })
  image.onload = image.onerror = null
  return image
}

/** QR SVG viewBox is one unit per module, including four quiet modules on each edge. */
export function posterQrSvg(link: string, color: string) {
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, { xmlns: 'http://www.w3.org/2000/svg', value: link, level: 'M', boostLevel: false, marginSize: 4, fgColor: color, bgColor: '#fff', size: 223 }))
  const modules = Number(svg.match(/viewBox="0 0 (\d+) /)?.[1])
  if (!modules) throw new Error('qr-size')
  const pixels = modules * Math.floor(223 / modules)
  return { svg: svg.replace(/width="223"/, `width="${pixels}"`).replace(/height="223"/, `height="${pixels}"`), pixels }
}

export async function renderSharePoster(input: PosterInput, resources: PosterResources): Promise<Blob> {
  const link = posterQrContent(input.code, input.link)
  const theme = POSTER_THEMES[input.style], layout = posterLayout(input.size), copy = posterCopy(input.language)
  const look = normalizeKunAvatarParts(input.look)
  const keys = kunAvatarLayerKeys(look, { size: layout.avatar.size, framing: 'portrait' })
  const qr = posterQrSvg(link, theme.qrfg)
  const qrUrl = URL.createObjectURL(new Blob([qr.svg], { type: 'image/svg+xml' }))
  const canvas = document.createElement('canvas')
  canvas.width = layout.width; canvas.height = layout.height
  const context = canvas.getContext('2d')
  if (!context) { URL.revokeObjectURL(qrUrl); throw new Error('canvas-unavailable') }
  const images: HTMLImageElement[] = []
  try {
    const artUrl = resources.artUrl(`${theme.art}-${input.size}.webp`)
    const settled = await Promise.allSettled([
      ...keys.map((key) => { const url = resources.layerUrl(key); return url ? loadPosterImage(url) : Promise.reject(new Error(`missing-layer:${key}`)) }),
      loadPosterImage(qrUrl),
      artUrl ? loadPosterImage(artUrl).catch(() => null) : Promise.resolve(null)
    ])
    for (const result of settled) if (result.status === 'fulfilled' && result.value) images.push(result.value)
    const failure = settled.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    const decoded = settled.map((result) => result.status === 'fulfilled' ? result.value : null)
    const rounded = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
      context.beginPath(); context.roundRect(x, y, w, h, r); context.fillStyle = fill; context.fill()
    }
    const text = (value: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = 'center', maxWidth = 920, mono = false) => {
      context.font = `${weight} ${size}px ${mono ? 'ui-monospace, "SF Mono", Menlo, monospace' : FONT}`
      context.fillStyle = color; context.textAlign = align; context.textBaseline = 'top'
      context.fillText(value, x, y, maxWidth)
    }
    const gradient = context.createLinearGradient(0, 0, 0, layout.height)
    theme.bg.forEach((color, index) => gradient.addColorStop(index / 2, color))
    context.fillStyle = gradient; context.fillRect(0, 0, 1080, layout.height)
    const art = decoded.at(-1)
    if (art) context.drawImage(art, 0, 0, 1080, layout.height)
    else if (input.style !== 'paper') {
      for (const [x, y, color] of [[120, 180, input.style === 'night' ? '#4488cc24' : '#ffa24420'], [1000, 560, '#aa77ff18']] as const) {
        const glow = context.createRadialGradient(x, y, 0, x, y, 450)
        glow.addColorStop(0, color); glow.addColorStop(1, 'transparent')
        context.fillStyle = glow; context.fillRect(0, 0, 1080, layout.height)
      }
      if (input.style === 'night') { context.beginPath(); context.arc(920, 100, 40, 0, Math.PI * 2); context.fillStyle = '#f3dfa6'; context.fill() }
    }
    context.font = `650 29px ${FONT}`
    const chipWidth = context.measureText(copy.kicker).width + 58
    rounded((1080 - chipWidth) / 2, layout.kickerY, chipWidth, 49, 25, theme.chip)
    text(copy.kicker, 540, layout.kickerY + 10, 29, theme.ink, 650)
    const a = layout.avatar
    context.save(); context.beginPath(); context.roundRect(a.x, a.y, a.size, a.size, a.radius); context.clip()
    if (!kunAvatarScene(look.bg) && look.bg !== 'transparent') { context.fillStyle = look.bg; context.fillRect(a.x, a.y, a.size, a.size) }
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    for (const [index, key] of keys.entries()) {
      context.save()
      const clip = key === `base/${look.color}` ? kunAvatarBodyClip(look) : undefined
      if (clip) {
        context.beginPath()
        clip.forEach(([x, y], i) => { const px = a.x + x / 1024 * a.size, py = a.y + y / 1024 * a.size; if (i === 0) context.moveTo(px, py); else context.lineTo(px, py) })
        context.closePath(); context.clip()
      }
      context.drawImage(decoded[index]!, a.x, a.y, a.size, a.size)
      context.restore()
    }
    context.restore()
    copy.title.forEach((line, index) => text(line, 540, layout.titleY + index * layout.titleSize * 1.25, layout.titleSize, theme.ink, 750))
    if (input.size === 'portrait') copy.lead.forEach((line, index) => text(line, 540, layout.titleY + 202 + index * 43, 33, theme.ink2))
    const c = layout.card
    rounded(c.x, c.y, c.width, c.height, 43, theme.card)
    const qrX = Math.round(c.x + c.width - 43 - layout.qrSize), qrY = Math.round(c.y + 36)
    rounded(qrX, qrY, layout.qrSize, layout.qrSize, 25, '#ffffff')
    context.imageSmoothingEnabled = false
    context.drawImage(decoded[keys.length]!, qrX + Math.floor((223 - qr.pixels) / 2), qrY + Math.floor((223 - qr.pixels) / 2), qr.pixels, qr.pixels)
    const tx = c.x + 43, width = qrX - tx - 36
    text(input.showCode ? copy.code : copy.scan, tx, c.y + 57, 26, theme.ink2, 500, 'left', width)
    text(input.showCode ? posterDisplayCode(input.code) : copy.gift, tx, c.y + 102, input.showCode ? 59 : 35, theme.ink, 650, 'left', width, input.showCode)
    text(link.replace(/^https:\/\//, ''), tx, c.y + 200, 24, theme.ink2, 400, 'left', width)
    text(copy.brand, 540, layout.brandY - 26, 26, theme.ink2, 400, 'center', 940)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('png-encode')), 'image/png'))
  } finally {
    URL.revokeObjectURL(qrUrl)
    images.forEach((image) => { image.src = '' })
    canvas.width = canvas.height = 1
  }
}
