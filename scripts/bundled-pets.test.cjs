'use strict'

const assert = require('node:assert/strict')
const { readdirSync, readFileSync, statSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const sharp = require('sharp')

const petsRoot = join(__dirname, '..', 'resources', 'pets')
const MIB = 1024 * 1024
// These already-compressed images enter both DMG and ZIP nearly unchanged.
// Keep enough headroom under the existing macOS arm64 artifact budgets.
const BUNDLED_PETS_BUDGET = 6 * MIB

function bytesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const file = join(dir, entry.name)
    return total + (entry.isDirectory() ? bytesUnder(file) : statSync(file).size)
  }, 0)
}

test('bundled pet assets fit within the macOS installer allowance', () => {
  const bytes = bytesUnder(petsRoot)
  assert(bytes <= BUNDLED_PETS_BUDGET,
    `Bundled pets use ${(bytes / MIB).toFixed(2)} MiB; limit is 6 MiB. Optimize new sheets before packaging.`)
})

test('every bundled pet retains a decodable transparent Codex sprite layout', async () => {
  const dirs = readdirSync(petsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
  assert(dirs.length > 0, 'An offline built-in pet must be available')
  for (const entry of dirs) {
    const manifest = JSON.parse(readFileSync(join(petsRoot, entry.name, 'pet.json'), 'utf8'))
    const version = manifest.spriteVersionNumber ?? 1
    assert([1, 2].includes(version), `${entry.name}: unsupported sprite version`)
    const image = sharp(join(petsRoot, entry.name, manifest.spritesheetPath))
    const metadata = await image.metadata()
    assert.equal(metadata.width, 1536, entry.name)
    assert.equal(metadata.height, version === 2 ? 2288 : 1872, entry.name)
    assert.equal(metadata.hasAlpha, true, entry.name)
    await image.raw().toBuffer()
  }
})
