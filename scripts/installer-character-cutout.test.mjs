import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import sharp from 'sharp'

import { createInstallerCharacterCutout } from './installer-character-cutout.mjs'

async function readRgba(buffer) {
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

function pixelAt(data, width, channels, x, y) {
  const offset = (y * width + x) * channels
  return {
    red: data[offset],
    green: data[offset + 1],
    blue: data[offset + 2],
    alpha: data[offset + 3]
  }
}

test('removes a trapped white halo around legs without eating solid white clothes', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-character-cutout-'))
  context.after(async () => rm(directory, { recursive: true, force: true }))

  const width = 80
  const height = 90
  const pixels = Buffer.alloc(width * height * 3, 255)

  const setPixel = (x, y, red, green, blue) => {
    const offset = (y * width + x) * 3
    pixels[offset] = red
    pixels[offset + 1] = green
    pixels[offset + 2] = blue
  }

  for (let y = 12; y <= 76; y += 1) {
    for (let x = 18; x <= 61; x += 1) {
      const onOuter = x === 18 || x === 61 || y === 12 || y === 76
      const inHalo = !onOuter && (x <= 22 || x >= 57 || y <= 16 || y >= 72)
      const onSeparator =
        !onOuter && !inHalo && (x === 23 || x === 56 || y === 17 || y === 71)
      const betweenLegs = y >= 48 && y <= 70 && x >= 36 && x <= 43
      if (onOuter) setPixel(x, y, 70, 90, 130)
      else if (inHalo || betweenLegs) setPixel(x, y, 252, 252, 252)
      else if (onSeparator) setPixel(x, y, 40, 90, 180)
      else if (y <= 40) setPixel(x, y, 236, 239, 246)
      else setPixel(x, y, 210, 150, 130)
    }
  }

  const sourcePath = join(directory, 'character.png')
  await writeFile(
    sourcePath,
    await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
  )

  const { data, info } = await readRgba(await createInstallerCharacterCutout(sourcePath))

  const outside = pixelAt(data, info.width, info.channels, 4, 4)
  const halo = pixelAt(data, info.width, info.channels, 20, 30)
  const betweenLegs = pixelAt(data, info.width, info.channels, 40, 60)
  const jacket = pixelAt(data, info.width, info.channels, 30, 28)
  const skin = pixelAt(data, info.width, info.channels, 28, 58)

  assert.equal(outside.alpha, 0)
  assert.equal(halo.alpha, 0)
  assert.equal(betweenLegs.alpha, 0)
  assert.ok(jacket.alpha > 200)
  assert.ok(jacket.red > 230)
  assert.ok(skin.alpha > 200)
  assert.ok(skin.red > skin.blue)
})
