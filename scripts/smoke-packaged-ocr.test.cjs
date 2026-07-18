const assert = require('node:assert/strict')
const { mkdir, mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')

const {
  createPackagedReexecInvocation,
  packagedNodeModulesPath,
  resolveResourcesDir
} = require('./smoke-packaged-ocr.cjs')

test('resolves a relative packaged resources override to an absolute path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kun-packaged-ocr-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const resourcesDir = join(root, 'dist', 'mac-arm64', 'Kun.app', 'Contents', 'Resources')
  await mkdir(resourcesDir, { recursive: true })

  assert.equal(
    resolveResourcesDir({
      root,
      environment: { KUN_PACKAGED_RESOURCES_DIR: 'dist/mac-arm64/Kun.app/Contents/Resources' }
    }),
    resourcesDir
  )
})

test('reexecutes OCR loading through the packaged Electron ASAR runtime', () => {
  const invocation = createPackagedReexecInvocation({
    runtimeExecutable: 'dist/mac-arm64/Kun.app/Contents/MacOS/Kun',
    resourcesDir: 'dist/mac-arm64/Kun.app/Contents/Resources',
    scriptPath: 'scripts/smoke-packaged-ocr.cjs',
    environment: { HOME: '/isolated' }
  })

  assert.equal(invocation.command, resolve('dist/mac-arm64/Kun.app/Contents/MacOS/Kun'))
  assert.deepEqual(invocation.args, [resolve('scripts/smoke-packaged-ocr.cjs')])
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(invocation.options.env.KUN_DISABLE_OS_CREDENTIAL_STORE, '1')
  assert.equal(invocation.options.env.KUN_PACKAGED_OCR_SMOKE_REEXEC, '1')
  assert.equal(
    invocation.options.env.KUN_PACKAGED_RESOURCES_DIR,
    resolve('dist/mac-arm64/Kun.app/Contents/Resources')
  )
  assert.equal(
    packagedNodeModulesPath(invocation.options.env.KUN_PACKAGED_RESOURCES_DIR),
    resolve('dist/mac-arm64/Kun.app/Contents/Resources/app.asar/node_modules')
  )
})
