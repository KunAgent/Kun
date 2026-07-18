#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join, resolve } = require('node:path')
const { resolvePackagedRuntimeExecutable } = require('./smoke-packaged-extensions.cjs')

const REEXEC_MARKER = 'KUN_PACKAGED_OCR_SMOKE_REEXEC'
const SUCCESS_MARKER = '[packaged-ocr-smoke] OCR dependencies loaded from '
const SMOKE_TIMEOUT_MS = 5 * 60_000

function fail(message) {
  console.error(`[packaged-ocr-smoke] ${message}`)
  process.exit(1)
}

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path))
}

function resolveResourcesDir({ root = process.cwd(), environment = process.env } = {}) {
  const resourcesDir = firstExisting([
    environment.KUN_PACKAGED_RESOURCES_DIR,
    join(root, 'dist', 'linux-unpacked', 'resources'),
    join(root, 'dist', 'win-unpacked', 'resources'),
    join(root, 'dist', 'mac-arm64', 'Kun.app', 'Contents', 'Resources'),
    join(root, 'dist', 'mac', 'Kun.app', 'Contents', 'Resources')
  ].map((candidate) => candidate && resolve(root, candidate)))
  if (!resourcesDir) {
    fail('Could not find packaged app resources. Set KUN_PACKAGED_RESOURCES_DIR or build a packaged app first.')
  }
  return resourcesDir
}

function requireFromPackagedNodeModules(packagedNodeModules) {
  return createRequire(join(packagedNodeModules, '.ocr-smoke.cjs'))
}

function packagedNodeModulesPath(resourcesDir) {
  return join(resourcesDir, 'app.asar', 'node_modules')
}

function createPackagedReexecInvocation({
  runtimeExecutable,
  resourcesDir,
  scriptPath = __filename,
  environment = process.env
}) {
  return {
    command: resolve(runtimeExecutable),
    args: [resolve(scriptPath)],
    options: {
      cwd: process.cwd(),
      env: {
        ...environment,
        ELECTRON_RUN_AS_NODE: '1',
        KUN_DISABLE_OS_CREDENTIAL_STORE: '1',
        KUN_PACKAGED_RESOURCES_DIR: resolve(resourcesDir),
        [REEXEC_MARKER]: '1'
      },
      shell: false,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: SMOKE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  }
}

async function main() {
  const resourcesDir = resolveResourcesDir()
  const runtimeExecutable = resolvePackagedRuntimeExecutable(resourcesDir)
  if (!runtimeExecutable) {
    fail(`Packaged OCR smoke requires a host-native packaged runtime beside ${resourcesDir}`)
  }
  if (process.env[REEXEC_MARKER] !== '1') {
    const invocation = createPackagedReexecInvocation({ runtimeExecutable, resourcesDir })
    const result = spawnSync(invocation.command, invocation.args, invocation.options)
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) fail(result.error.stack || result.error.message)
    if (result.status !== 0) {
      fail(`Packaged OCR smoke child failed (${result.signal ?? result.status ?? 'unknown exit'})`)
    }
    if (!String(result.stdout ?? '').includes(SUCCESS_MARKER)) {
      fail('Packaged OCR smoke child omitted its completion marker')
    }
    return
  }

  const unpackedNodeModules = join(resourcesDir, 'app.asar.unpacked', 'node_modules')
  const packagedNodeModules = packagedNodeModulesPath(resourcesDir)

  if (!existsSync(join(resourcesDir, 'app.asar'))) {
    fail(`Missing app.asar in ${resourcesDir}`)
  }
  if (!existsSync(unpackedNodeModules)) {
    fail(`Missing unpacked node_modules in ${unpackedNodeModules}`)
  }

  const packagedRequire = requireFromPackagedNodeModules(packagedNodeModules)
  const canvas = packagedRequire('@napi-rs/canvas')
  const sharpModule = packagedRequire('sharp')
  const sharp = typeof sharpModule === 'function' ? sharpModule : sharpModule.default
  const tesseractModule = packagedRequire('tesseract.js')
  const tesseract = typeof tesseractModule.createWorker === 'function'
    ? tesseractModule
    : tesseractModule.default
  const languageData = packagedRequire('@tesseract.js-data/eng')

  if (typeof canvas.createCanvas !== 'function') {
    fail('Packaged @napi-rs/canvas did not expose createCanvas.')
  }
  if (typeof sharp !== 'function') {
    fail('Packaged sharp did not expose its image factory.')
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

  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const decoded = await sharp(onePixelPng, { failOn: 'error', limitInputPixels: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (decoded.info.width !== 1 || decoded.info.height !== 1) {
    fail(`Packaged sharp returned unexpected dimensions: ${decoded.info.width}x${decoded.info.height}`)
  }

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

if (require.main === module) {
  main().catch((error) => {
    fail(error instanceof Error ? error.stack || error.message : String(error))
  })
}

module.exports = {
  createPackagedReexecInvocation,
  packagedNodeModulesPath,
  resolveResourcesDir
}
