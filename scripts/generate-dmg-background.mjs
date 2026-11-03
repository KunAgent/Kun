import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { createInstallerCharacterCutout } from './installer-character-cutout.mjs'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = join(repositoryRoot, 'build')
const characterPath = join(buildDirectory, 'dmg-character.png')
const appIconPath = join(repositoryRoot, 'src', 'asset', 'img', 'kun_mac.png')
const backgroundPath = join(buildDirectory, 'dmg-background.png')
const retinaBackgroundPath = join(buildDirectory, 'dmg-background@2x.png')

const width = 660
const height = 430
const scale = 2

// Finder draws the icon labels (black) itself and ignores the dark appearance
// for picture backgrounds, so the artwork is light only. The Kun and
// Applications icons sit at the Finder positions in electron-builder.config.cjs
// (centers 364,284 and 548,284); the artwork leaves the tray and drop slot
// behind them.
const font = "'PingFang SC', 'Hiragino Sans GB', -apple-system, 'Helvetica Neue', Arial, sans-serif"

function backgroundSvg(targetWidth, targetHeight) {
  const f = targetWidth / width

  return Buffer.from(`
    <svg width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${width} ${height}"
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="card"><rect x="32" y="24" width="220" height="352" rx="20"/></clipPath>
      </defs>
      <rect width="${width}" height="${height}" fill="#fcfcfd"/>

      <rect x="32" y="24" width="220" height="352" rx="20" fill="#ecf3ff"/>
      <circle cx="158" cy="88" r="70" fill="#dce9ff" clip-path="url(#card)"/>
      <ellipse cx="160" cy="358" rx="55" ry="5" fill="#0550c8" opacity="0.10"/>
      <ellipse cx="100" cy="346" rx="25" ry="4" fill="#0550c8" opacity="0.10"/>
      <rect x="32.5" y="24.5" width="219" height="351" rx="19.5" fill="none" stroke="#dde8fb"/>

      <text x="338" y="60" font-family="${font}" font-size="28" font-weight="650"
        letter-spacing="-0.2" fill="#20242d">Kun</text>
      <text x="286" y="109" font-family="${font}" font-size="14" fill="#687083">本地优先的 AI 智能体工作台</text>
      <text x="286" y="133" font-family="${font}" font-size="12" fill="#9299a8">Local-first AI agent workspace</text>

      <rect x="284.5" y="160.5" width="343" height="215" rx="19.5" fill="#f5f6f8" stroke="#e7e9ee"/>
      <text x="456" y="195" text-anchor="middle" font-family="${font}" font-size="14"
        font-weight="600" fill="#20242d">拖动 Kun 到 Applications 文件夹</text>
      <text x="456" y="218" text-anchor="middle" font-family="${font}" font-size="12"
        fill="#8a92a3">Drag Kun onto the Applications folder</text>

      <rect x="492.75" y="228.75" width="110.5" height="110.5" rx="25.5" fill="#edf2ff"
        stroke="#b8c9fb" stroke-width="1.5" stroke-dasharray="5 4"/>
      <path d="M 418 284 H 474" fill="none" stroke="#0570fd" stroke-width="2"
        stroke-linecap="round" stroke-dasharray="5 5"/>
      <path d="M 469 277 L 477 284 L 469 291" fill="none" stroke="#0570fd" stroke-width="2.4"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `)
}

async function renderRetinaBackground() {
  const characterCutout = await createInstallerCharacterCutout(characterPath)
  const character = await sharp(characterCutout)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 }, threshold: 2 })
    .resize({
      width: 156 * scale,
      height: 324 * scale,
      fit: 'contain',
      position: 'south',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer()
  const appIcon = await sharp(appIconPath)
    .resize(48 * scale, 48 * scale)
    .png()
    .toBuffer()

  await sharp(backgroundSvg(width * scale, height * scale))
    .composite([
      { input: character, left: 64 * scale, top: 38 * scale },
      { input: appIcon, left: 284 * scale, top: 28 * scale }
    ])
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
