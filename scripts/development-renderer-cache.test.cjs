'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')
const {
  developmentRendererEnvironment
} = require('./development-renderer-environment.cjs')

const repositoryRoot = resolve(__dirname, '..')
const rendererConfigUrl = pathToFileURL(
  join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
).href

function loadRendererConfig(environment) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const config = (await import(${JSON.stringify(rendererConfigUrl)})).default; process.stdout.write(String(config.cacheDir ?? ''))`
    ],
    {
      cwd: repositoryRoot,
      env: environment,
      encoding: 'utf8'
    }
  )
}

test('development smoke environment assigns a cache beneath its unique temporary root', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-renderer-cache-test-'))
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))

  const environment = developmentRendererEnvironment(
    { PATH: process.env.PATH },
    { rendererPort: 51_74, temporaryRoot }
  )

  assert.equal(environment.ELECTRON_RENDERER_URL, 'http://127.0.0.1:5174')
  assert.equal(environment.KUN_ELECTRON_VITE_PORT, '5174')
  assert.equal(environment.KUN_ELECTRON_VITE_CACHE_DIR, join(temporaryRoot, 'vite-cache'))
})

test('auxiliary Vite config uses the explicit isolated cache directory', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-renderer-config-test-'))
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  const cacheDir = join(temporaryRoot, 'vite-cache')
  const result = loadRendererConfig({
    ...process.env,
    KUN_ELECTRON_VITE_PORT: '5174',
    KUN_ELECTRON_VITE_CACHE_DIR: cacheDir
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, cacheDir)
})

test('auxiliary Vite config fails closed when no isolated cache is provided', () => {
  const environment = {
    ...process.env,
    KUN_ELECTRON_VITE_PORT: '5174'
  }
  delete environment.KUN_ELECTRON_VITE_CACHE_DIR

  const result = loadRendererConfig(environment)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /KUN_ELECTRON_VITE_CACHE_DIR must select an absolute isolated Vite cache directory/)
})
