import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

import sharp from 'sharp'

import { createInstallerCharacterCutout } from './installer-character-cutout.mjs'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = join(repositoryRoot, 'build')
const characterPath = join(buildDirectory, 'dmg-character.png')
const sidebarPath = join(buildDirectory, 'installerSidebar.bmp')
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

function sidebarSvg() {
  const width = 164 * renderScale
  const height = 314 * renderScale

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 164 314" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#071a3e"/>
          <stop offset="0.54" stop-color="#0b4fae"/>
          <stop offset="1" stop-color="#0aa8f7"/>
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#71d9ff" stop-opacity="0.72"/>
          <stop offset="1" stop-color="#71d9ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="164" height="314" fill="url(#surface)"/>
      <ellipse cx="91" cy="176" rx="103" ry="137" fill="url(#glow)"/>
      <path d="M 0 0 H 164 V 93 Z" fill="#128bf2" opacity="0.18"/>
      <path d="M 54 0 H 164 V 54 Z" fill="#7ddcff" opacity="0.14"/>
      <circle cx="145" cy="20" r="2" fill="#8fe5ff" opacity="0.9"/>
      <circle cx="137" cy="20" r="2" fill="#8fe5ff" opacity="0.55"/>
      <circle cx="129" cy="20" r="2" fill="#8fe5ff" opacity="0.3"/>

      <g transform="translate(16 18)">
        <path d="M 0 0 h 7 v 28 H 0 Z" fill="#ffffff"/>
        <path d="M 8 14 L 25 0 h 10 L 18 14 l 18 14 H 26 Z" fill="#ffffff"/>
        <text x="45" y="25" font-family="Arial, 'Segoe UI', sans-serif" font-size="25"
          font-weight="700" letter-spacing="3" fill="#ffffff">KUN</text>
        <text x="1" y="43" font-family="Arial, 'Segoe UI', sans-serif" font-size="5.7"
          font-weight="600" letter-spacing="1.4" fill="#bdeaff">AI AGENT WORKSPACE</text>
      </g>

      <path d="M 18 69 H 146" stroke="#8cddff" stroke-width="0.7" opacity="0.5"/>
      <circle cx="18" cy="69" r="1.4" fill="#b8ecff"/>
      <circle cx="146" cy="69" r="1.4" fill="#b8ecff"/>
    </svg>
  `)
}

function headerSvg() {
  const width = 150 * renderScale
  const height = 57 * renderScale

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 150 57" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#dff2ff"/>
        </linearGradient>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0a50e8"/>
          <stop offset="1" stop-color="#08aaf8"/>
        </linearGradient>
      </defs>
      <rect width="150" height="57" fill="url(#surface)"/>
      <path d="M 85 0 H 150 V 57 H 124 Z" fill="#5bc8ff" opacity="0.12"/>
      <path d="M 117 0 H 150 V 32 Z" fill="#0a8ff0" opacity="0.12"/>
      <g transform="translate(13 12)">
        <path d="M 0 0 h 8 v 31 H 0 Z" fill="url(#brand)"/>
        <path d="M 9 16 L 28 0 h 11 L 20 16 l 20 15 H 29 Z" fill="url(#brand)"/>
        <text x="49" y="25" font-family="Arial, 'Segoe UI', sans-serif" font-size="24"
          font-weight="700" letter-spacing="3" fill="#10213b">KUN</text>
      </g>
      <circle cx="136" cy="45" r="2" fill="#149ff5" opacity="0.8"/>
      <circle cx="143" cy="45" r="2" fill="#149ff5" opacity="0.4"/>
    </svg>
  `)
}

async function write24BitBmp(input, width, height, outputPath) {
  const { data, info } = await sharp(input)
    .flatten({ background: '#ffffff' })
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  await writeFile(outputPath, encode24BitBmp(data, info.width, info.height))
}

async function renderSidebar(characterCutout) {
  const character = await sharp(characterCutout)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 }, threshold: 2 })
    .resize({
      width: 162 * renderScale,
      height: 243 * renderScale,
      fit: 'contain',
      position: 'south',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer()
  const sidebar = await sharp(sidebarSvg())
    .composite([{ input: character, left: 1 * renderScale, top: 70 * renderScale }])
    .png()
    .toBuffer()

  await write24BitBmp(sidebar, 164, 314, sidebarPath)
}

const characterCutout = await createInstallerCharacterCutout(characterPath)
await renderSidebar(characterCutout)
await write24BitBmp(headerSvg(), 150, 57, headerPath)

console.log(`Generated ${sidebarPath}`)
console.log(`Generated ${headerPath}`)
