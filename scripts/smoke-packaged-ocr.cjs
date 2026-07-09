#!/usr/bin/env node

const { existsSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join } = require('node:path')

function fail(message) {
  console.error(`[packaged-ocr-smoke] ${message}`)
  process.exit(1)
}

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path))
}

function resolveResourcesDir() {
  const root = process.cwd()
  const resourcesDir = firstExisting([
    process.env.KUN_PACKAGED_RESOURCES_DIR,
    join(root, 'dist', 'linux-unpacked', 'resources'),
    join(root, 'dist', 'win-unpacked', 'resources'),
    join(root, 'dist', 'mac-arm64', 'Kun.app', 'Contents', 'Resources'),
    join(root, 'dist', 'mac', 'Kun.app', 'Contents', 'Resources')
  ])
  if (!resourcesDir) {
    fail('Could not find packaged app resources. Set KUN_PACKAGED_RESOURCES_DIR or build a packaged app first.')
  }
  return resourcesDir
}

function requireFromPackagedNodeModules(unpackedNodeModules) {
  return createRequire(join(unpackedNodeModules, '.ocr-smoke.cjs'))
}

async function main() {
  const resourcesDir = resolveResourcesDir()
  const unpackedNodeModules = join(resourcesDir, 'app.asar.unpacked', 'node_modules')

  if (!existsSync(join(resourcesDir, 'app.asar'))) {
    fail(`Missing app.asar in ${resourcesDir}`)
  }
  if (!existsSync(unpackedNodeModules)) {
    fail(`Missing unpacked node_modules in ${unpackedNodeModules}`)
  }

  const packagedRequire = requireFromPackagedNodeModules(unpackedNodeModules)
  const canvas = packagedRequire('@napi-rs/canvas')
  const tesseractModule = packagedRequire('tesseract.js')
  const tesseract = typeof tesseractModule.createWorker === 'function'
    ? tesseractModule
    : tesseractModule.default
  const languageData = packagedRequire('@tesseract.js-data/eng')

  if (typeof canvas.createCanvas !== 'function') {
    fail('Packaged @napi-rs/canvas did not expose createCanvas.')
  }
  if (typeof tesseract?.createWorker !== 'function') {
    fail('Packaged tesseract.js did not expose createWorker.')
  }
  if (!languageData?.langPath || !existsSync(languageData.langPath)) {
    fail(`Packaged English Tesseract data path is missing: ${languageData?.langPath ?? '<empty>'}`)
  }

  const testCanvas = canvas.createCanvas(96, 40)
  const context = testCanvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, testCanvas.width, testCanvas.height)
  testCanvas.toBuffer('image/png')

  let worker = null
  try {
    worker = await tesseract.createWorker('eng', 1, {
      langPath: languageData.langPath,
      gzip: languageData.gzip ?? true,
      cacheMethod: 'none',
      logger: () => undefined
    })
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? '3'
    })
  } finally {
    if (worker) await worker.terminate().catch(() => undefined)
  }

  console.log(`[packaged-ocr-smoke] OCR dependencies loaded from ${resourcesDir}`)
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error))
})
