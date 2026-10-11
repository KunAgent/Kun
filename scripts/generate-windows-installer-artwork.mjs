import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

import sharp from 'sharp'

import { createInstallerCharacterCutout } from './installer-character-cutout.mjs'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = join(repositoryRoot, 'build')
const characterPath = join(buildDirectory, 'dmg-character.png')
const sidebarPath = join(buildDirectory, 'installerSidebar.bmp')
const uninstallerSidebarPath = join(buildDirectory, 'uninstallerSidebar.bmp')
const headerPath = join(buildDirectory, 'installerHeader.bmp')
const renderScale = 4

function encode24BitBmp(rgbaData, width, height) {
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixelDataSize = rowStride * height
  const bitmap = Buffer.alloc(54 + pixelDataSize)

  bitmap.write('BM', 0, 2, 'ascii')
  bitmap.writeUInt32LE(bitmap.length, 2)
  bitmap.writeUInt32LE(54, 10)
  bitmap.writeUInt32LE(40, 14)
  bitmap.writeInt32LE(width, 18)
  bitmap.writeInt32LE(height, 22)
  bitmap.writeUInt16LE(1, 26)
  bitmap.writeUInt16LE(24, 28)
  bitmap.writeUInt32LE(pixelDataSize, 34)

  for (let targetRow = 0; targetRow < height; targetRow += 1) {
    const sourceRow = height - targetRow - 1
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceRow * width + x) * 4
      const targetOffset = 54 + targetRow * rowStride + x * 3
      bitmap[targetOffset] = rgbaData[sourceOffset + 2]
      bitmap[targetOffset + 1] = rgbaData[sourceOffset + 1]
      bitmap[targetOffset + 2] = rgbaData[sourceOffset]
    }
  }

  return bitmap
}

const mascotDirectory = join(repositoryRoot, 'src', 'asset', 'img')
const appIconPath = join(mascotDirectory, 'kun_mac.png')
const fontFamily = "'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', Arial, sans-serif"

function svgDocument(width, height, body) {
  return Buffer.from(`
    <svg width="${width * renderScale}" height="${height * renderScale}" viewBox="0 0 ${width} ${height}"
      xmlns="http://www.w3.org/2000/svg">${body}</svg>
  `)
}

async function scaled(input, width, height, options = {}) {
  return sharp(input)
    .trim({ threshold: 2 })
    .resize({
      width: Math.round(width * renderScale),
      height: Math.round(height * renderScale),
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      ...options
    })
    .png()
    .toBuffer()
}

async function brandMark(left, top, size, labelColor) {
  return {
    icon: { input: await scaled(appIconPath, size, size), left: left * renderScale, top: top * renderScale },
    label: `<text x="${left + size + 4}" y="${top + 18}" font-family="${fontFamily}" font-size="16"
      font-weight="700" fill="${labelColor}">Kun</text>`
  }
}

async function renderSidebar(characterCutout) {
  const mark = await brandMark(14, 14, 26, '#20242d')
  const svg = svgDocument(164, 314, `
    <rect width="164" height="314" fill="#ecf3ff"/>
    <circle cx="92" cy="118" r="65" fill="#dce9ff"/>
    ${mark.label}
  `)
  const character = await sharp(characterCutout)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 }, threshold: 2 })
    .resize({ width: 212 * renderScale, height: 440 * renderScale, fit: 'fill' })
    .extract({ left: 36 * renderScale, top: 0, width: 164 * renderScale, height: 250 * renderScale })
    .png()
    .toBuffer()
  // Portrait crop: the figure bleeds off the bottom edge so the face stays large
  // at 100% scale; the bitmap is stretched at higher DPI, so it carries no small text.
  const composed = await sharp(svg)
    .composite([
      { input: character, left: 0, top: 64 * renderScale },
      mark.icon
    ])
    .png()
    .toBuffer()

  await write24BitBmp(composed, 164, 314, sidebarPath, '#ecf3ff')
}

async function renderUninstallerSidebar() {
  const mark = await brandMark(14, 14, 26, '#20242d')
  const svg = svgDocument(164, 314, `
    <rect width="164" height="314" fill="#f1f4f9"/>
    <circle cx="82" cy="188" r="60" fill="#e4ebf7"/>
    <ellipse cx="82" cy="267" rx="52" ry="5" fill="#283c6e" opacity="0.10"/>
    <text x="124" y="158" font-family="${fontFamily}" font-size="16" font-weight="700" fill="#a9bbe0">Z</text>
    <text x="138" y="141" font-family="${fontFamily}" font-size="12" font-weight="700" fill="#bccaea">Z</text>
    <text x="148" y="127" font-family="${fontFamily}" font-size="9" font-weight="700" fill="#cdd8f0">Z</text>
    ${mark.label}
  `)
  const bird = await scaled(join(mascotDirectory, 'kun_sleep.png'), 128, 98)
  const composed = await sharp(svg)
    .composite([
      { input: bird, left: 18 * renderScale, top: 170 * renderScale },
      mark.icon
    ])
    .png()
    .toBuffer()

  await write24BitBmp(composed, 164, 314, uninstallerSidebarPath, '#f1f4f9')
}

async function renderHeader() {
  const svg = svgDocument(150, 57, `
    <rect width="150" height="57" fill="#ffffff"/>
    <circle cx="116" cy="30" r="24" fill="#ecf3ff"/>
  `)
  const bird = await scaled(join(mascotDirectory, 'kun_laptop.png'), 47, 46)
  const composed = await sharp(svg)
    .composite([{ input: bird, left: 92 * renderScale, top: 9 * renderScale }])
    .png()
    .toBuffer()

  await write24BitBmp(composed, 150, 57, headerPath)
}

async function write24BitBmp(input, width, height, outputPath, flattenColor = '#ffffff') {
  const { data, info } = await sharp(input)
    .flatten({ background: flattenColor })
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  await writeFile(outputPath, encode24BitBmp(data, info.width, info.height))
}

const characterCutout = await createInstallerCharacterCutout(characterPath)
await renderSidebar(characterCutout)
await renderUninstallerSidebar()
await renderHeader()

console.log(`Generated ${sidebarPath}`)
console.log(`Generated ${uninstallerSidebarPath}`)
console.log(`Generated ${headerPath}`)
