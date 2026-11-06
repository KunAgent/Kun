'use strict'

const assert = require('node:assert/strict')
const { readdirSync, readFileSync, statSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { createHash } = require('node:crypto')
const sharp = require('sharp')

const petsRoot = join(__dirname, '..', 'resources', 'pets')
const MIB = 1024 * 1024
// These already-compressed images enter both DMG and ZIP nearly unchanged.
// Keep enough headroom under the existing macOS arm64 artifact budgets.
const BUNDLED_PETS_BUDGET = 19 * MIB
const CHIBI_AI_PETS = [
  'claude-girl', 'doubao-girl', 'gemini-girl', 'glm-girl', 'gpt-girl', 'grok-girl',
  'hunyuan-girl', 'kimi-girl', 'llama-girl', 'mimo-girl', 'minimax-girl',
  'mistral-girl', 'qwen-girl', 'seed-girl'
]

function bytesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const file = join(dir, entry.name)
    return total + (entry.isDirectory() ? bytesUnder(file) : statSync(file).size)
  }, 0)
}

test('bundled pet assets fit within the macOS installer allowance', () => {
  const bytes = bytesUnder(petsRoot)
  assert(bytes <= BUNDLED_PETS_BUDGET,
    `Bundled pets use ${(bytes / MIB).toFixed(2)} MiB; limit is 19 MiB. Optimize new sheets before packaging.`)
})

test('only the two Kun mascots and fifteen AI companions ship as built-ins', () => {
  const ids = readdirSync(petsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.deepEqual(ids, ['xiao-kun', 'ikun', 'whale-girl', ...CHIBI_AI_PETS].sort())
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

for (const id of ['xiao-kun', 'ikun', 'whale-girl', ...CHIBI_AI_PETS]) {
  test(`${id} fits its allowance and has all 57 animation frames with clear cell margins`, async () => {
    const dir = join(petsRoot, id)
    const budget = CHIBI_AI_PETS.includes(id) ? MIB * 0.75 : MIB
    assert(bytesUnder(dir) <= budget, `${id} must fit within ${budget / 1024} KiB`)
    const manifest = JSON.parse(readFileSync(join(dir, 'pet.json'), 'utf8'))
    assert.equal(manifest.id, id)
    assert.equal(manifest.spriteVersionNumber, 1)
    const { data, info } = await sharp(join(dir, manifest.spritesheetPath)).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true })
    const frameCounts = [6, 8, 8, 4, 5, 8, 6, 6, 6]
    for (let row = 0; row < frameCounts.length; row++) {
      const distinct = new Set()
      for (let col = 0; col < 8; col++) {
        const label = `${id} row ${row + 1}, frame ${col + 1}`
        const frame = Buffer.alloc(192 * 208 * 4)
        let visible = 0
        for (let y = 0; y < 208; y++) {
          const offset = ((row * 208 + y) * info.width + col * 192) * 4
          data.copy(frame, y * 192 * 4, offset, offset + 192 * 4)
          for (let x = 0; x < 192; x++) {
            const alpha = data[offset + x * 4 + 3]
            if (alpha > 16) visible++
            if (x < 6 || x >= 186 || y < 6 || y >= 202) {
              assert(alpha <= 16, `${label}: artwork touches cell margin`)
            }
          }
        }
        if (col >= frameCounts[row]) {
          assert.equal(visible, 0, `${label}: unused cell must be transparent`)
        } else {
          assert(visible > 192 * 208 * 0.15, `${label}: missing or undersized artwork`)
          assert(visible < 192 * 208 * 0.8, `${label}: opaque background`)
          distinct.add(createHash('sha256').update(frame).digest('hex'))
        }
      }
      assert(distinct.size >= 3, `${id} row ${row + 1}: needs distinct animation poses`)
    }
  })
}

test('the chibi AI collection has distinct artwork and ships each attribution', () => {
  const designs = new Set()
  for (const id of CHIBI_AI_PETS) {
    const dir = join(petsRoot, id)
    const sheet = readFileSync(join(dir, 'spritesheet.webp'))
    designs.add(createHash('sha256').update(sheet).digest('hex'))
    const attribution = readFileSync(join(dir, 'ATTRIBUTION.md'), 'utf8')
    assert(attribution.includes(`characters/${id.replace(/-girl$/, '')}`), `${id}: missing source record`)
  }
  assert.equal(designs.size, CHIBI_AI_PETS.length, 'Each AI companion needs its own character artwork')
})
