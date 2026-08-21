import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { createInstallerCharacterCutout } from './installer-character-cutout.mjs'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = join(repositoryRoot, 'build')
const characterPath = join(buildDirectory, 'dmg-character.png')
const backgroundPath = join(buildDirectory, 'dmg-background.png')
const retinaBackgroundPath = join(buildDirectory, 'dmg-background@2x.png')

const width = 660
const height = 430
const scale = 2

function backgroundSvg(targetWidth, targetHeight) {
  const factor = targetWidth / width
  const value = (number) => number * factor

  return Buffer.from(`
    <svg width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}"
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="0.62" stop-color="#f8fbff"/>
          <stop offset="1" stop-color="#edf6ff"/>
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#20a8ff" stop-opacity="0.18"/>
          <stop offset="1" stop-color="#20a8ff" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0b54e8"/>
          <stop offset="1" stop-color="#0aa8ff"/>
        </linearGradient>
        <filter id="softShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="${value(5)}"/>
        </filter>
      </defs>

      <rect width="${targetWidth}" height="${targetHeight}" fill="url(#surface)"/>
      <ellipse cx="${value(525)}" cy="${value(75)}" rx="${value(205)}" ry="${value(150)}" fill="url(#glow)"/>
      <path d="M ${value(310)} 0 L ${value(660)} 0 L ${value(660)} ${value(186)} Z"
        fill="#e7f4ff" opacity="0.34"/>
      <path d="M ${value(382)} 0 L ${value(660)} 0 L ${value(660)} ${value(102)} Z"
        fill="#d9efff" opacity="0.38"/>
      <circle cx="${value(622)}" cy="${value(42)}" r="${value(3)}" fill="#0a92ff" opacity="0.58"/>
      <circle cx="${value(605)}" cy="${value(42)}" r="${value(3)}" fill="#0a92ff" opacity="0.30"/>
      <circle cx="${value(588)}" cy="${value(42)}" r="${value(3)}" fill="#0a92ff" opacity="0.16"/>

      <g transform="translate(${value(330)} ${value(55)})">
        <path d="M 0 ${value(2)} h ${value(11)} v ${value(44)} H 0 Z" fill="url(#brand)"/>
        <path d="M ${value(12)} ${value(24)} L ${value(39)} ${value(1)} h ${value(15)} L ${value(28)} ${value(24)}
          L ${value(55)} ${value(47)} H ${value(40)} Z" fill="url(#brand)"/>
        <text x="${value(70)}" y="${value(43)}"
          font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"
          font-size="${value(43)}" font-weight="750" letter-spacing="${value(7)}" fill="#10213b">KUN</text>
        <text x="${value(1)}" y="${value(72)}"
          font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"
          font-size="${value(10)}" font-weight="600" letter-spacing="${value(2.6)}" fill="#52708f">
          LOCAL-FIRST AI AGENT WORKSPACE
        </text>
      </g>

      <g transform="translate(${value(417)} ${value(291)})">
        <path d="M ${value(2)} ${value(13)} H ${value(45)}" stroke="#8aa9c8" stroke-width="${value(7)}"
          stroke-linecap="round" opacity="0.34" filter="url(#softShadow)"/>
        <path d="M ${value(2)} ${value(13)} H ${value(45)}" stroke="#8ba6c2" stroke-width="${value(5)}"
          stroke-linecap="round"/>
        <path d="M ${value(37)} ${value(3)} L ${value(48)} ${value(13)} L ${value(37)} ${value(23)}"
          fill="none" stroke="#8ba6c2" stroke-width="${value(5)}" stroke-linecap="round"
          stroke-linejoin="round"/>
      </g>

      <text x="${value(444)}" y="${value(196)}" text-anchor="middle"
        font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"
        font-size="${value(10)}" font-weight="650" letter-spacing="${value(2.5)}" fill="#8aa1ba">
        DRAG TO INSTALL
      </text>
      <path d="M ${value(340)} ${value(213)} H ${value(548)}" stroke="#d6e5f3" stroke-width="${value(1)}"/>
      <circle cx="${value(340)}" cy="${value(213)}" r="${value(2)}" fill="#18a0fb"/>
      <circle cx="${value(548)}" cy="${value(213)}" r="${value(2)}" fill="#18a0fb"/>
    </svg>
  `)
}

async function renderRetinaBackground() {
  const characterCutout = await createInstallerCharacterCutout(characterPath)
  const character = await sharp(characterCutout)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 }, threshold: 2 })
    .resize({
      width: 272 * scale,
      height: 390 * scale,
      fit: 'contain',
      position: 'south',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer()

  await sharp(backgroundSvg(width * scale, height * scale))
    .composite([{ input: character, left: 22 * scale, top: 5 * scale }])
    .png({ compressionLevel: 9 })
    .toFile(retinaBackgroundPath)
}

async function renderStandardBackground() {
  await sharp(retinaBackgroundPath)
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(backgroundPath)
}

await renderRetinaBackground()
await renderStandardBackground()

console.log(`Generated ${backgroundPath}`)
console.log(`Generated ${retinaBackgroundPath}`)
