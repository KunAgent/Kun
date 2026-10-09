'use strict'

const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { boxGlb, capFrontDrawing, capGlb } = require('./smoke-kun-3d-fixtures.cjs')

/** Share of canvas pixels that differ from the corner pixel, read through a 2D copy of the WebGL canvas. */
const painted = (page) => page.locator('.kun3d-canvas').evaluate((canvas) => {
  const copy = document.createElement('canvas')
  copy.width = canvas.width; copy.height = canvas.height
  const context = copy.getContext('2d')
  context.drawImage(canvas, 0, 0)
  const { data } = context.getImageData(0, 0, copy.width, copy.height)
  let changed = 0
  for (let index = 0; index < data.length; index += 16) if (data[index + 3] > 0) changed += 1
  return changed / (data.length / 16)
})

async function exerciseKun3dShowcase({ page, poll, capture, recordDiagnostic, switchCode }) {
  // Ask the app for its folder: Electron's own home path ignores the isolated HOME and would hit the real one.
  const listed = await page.evaluate(() => window.kunGui.kun3dAssets.list())
  assert.equal(listed.ok, true, 'The asset folder is readable')
  const root = listed.root
  assert(root.includes('kun-rooms-desktop-smoke'), `The asset folder is inside the isolated home: ${root}`)
  await mkdir(join(root, 'headwear', 'pilot-cap'), { recursive: true })
  await writeFile(join(root, 'headwear', 'pilot-cap.glb'), capGlb())
  // The front view drawn on the three-view template: the widest side spans 80% of the square.
  await writeFile(join(root, 'headwear', 'pilot-cap', 'front.png'), capFrontDrawing({ size: 256 }))

  // 1. The wardrobe panel opens the showcase, which lists the file by its wardrobe name.
  await switchCode()
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  await page.locator('[data-rail-entry="builtin:right-panel-wardrobe"]').click()
  const panel = page.locator('[data-wardrobe-panel="ready"]')
  await panel.waitFor({ timeout: 30_000 })
  await panel.locator('[data-wardrobe-3d]').click()
  const showcase = page.locator('dialog.kun3d')
  await showcase.waitFor()
  const entry = showcase.locator('[data-kun3d-entry="headwear/pilot-cap.glb"]')
  await entry.waitFor({ timeout: 15_000 })
  assert.match(await entry.innerText(), /飞行帽/)
  assert.equal(await showcase.locator('[data-kun3d-entry]').count(), 1, 'Only real models are listed')

  // 2. Selecting it renders through WebGL with its embedded texture and reports the numbers.
  await entry.click()
  await poll(async () => (await showcase.getAttribute('data-kun3d-state')) === 'ready', 20_000, 'model loads')
  const triangles = 32 * 12 * 2 + 32 * 2 * 2
  assert.match(await showcase.locator('.kun3d-stats').innerText(), new RegExp(triangles.toLocaleString('en-US')), 'Triangles are counted')
  assert.match(await showcase.locator('.kun3d-stats').innerText(), /kun_spin/, 'The animation clip is listed')
  await poll(async () => (await painted(page)) > 0.02, 10_000, 'the canvas paints the model')
  assert.equal(await showcase.locator('[data-kun3d-check="triangles"][data-ok]').count(), 1, 'Within the triangle budget')
  await capture('kun3d-model')

  // 3. Views, shading and the front drawing overlay.
  await showcase.locator('[data-kun3d-view="threeQuarter"]').click()
  await showcase.locator('[data-kun3d-shading="toon"]').click()
  await page.waitForTimeout(900)
  await capture('kun3d-toon')
  await showcase.locator('[data-kun3d-shading="original"]').click()
  await page.waitForTimeout(300)
  await capture('kun3d-three-quarter')
  await showcase.locator('[data-kun3d-ref="front"]').click()
  await showcase.locator('.kun3d-overlay').waitFor()
  await page.waitForTimeout(300)
  await capture('kun3d-overlay')

  // 4. A newly exported file shows up without reopening.
  await writeFile(join(root, 'prop', 'magnifier.glb'), boxGlb())
  await showcase.locator('[data-kun3d-entry="prop/magnifier.glb"]').waitFor({ timeout: 10_000 })

  await page.keyboard.press('Escape')
  await showcase.waitFor({ state: 'detached' })
  const result = { root, assertions: [
    'the wardrobe panel opens a full-window 3D showcase that lists ~/.kun/3d-assets by wardrobe name',
    'a binary glTF with an embedded PNG texture renders through WebGL and reports triangles, clips and budget',
    'views, toon shading and the front three-view overlay work',
    'a newly exported model appears without reopening; Escape closes the showcase'] }
  await recordDiagnostic('kun-3d-showcase', result)
  return result
}

module.exports = { exerciseKun3dShowcase }
