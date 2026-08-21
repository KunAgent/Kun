'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  packageNameFromSpecifier,
  sourceSpecifiers,
  isProductionPackage,
  RENDERER_BUNDLED_ONLY_PACKAGES,
  rendererBundledOnlyFailures,
  formatRendererBundledOnlyError
} = require('./check-packaged-runtime-dependencies.cjs')

test('normalizes compiled external specifiers to package names', () => {
  assert.equal(packageNameFromSpecifier('@google/design.md/linter'), '@google/design.md')
  assert.equal(packageNameFromSpecifier('pdfjs-dist/legacy/build/pdf.mjs'), 'pdfjs-dist')
  assert.equal(packageNameFromSpecifier('node:fs'), undefined)
  assert.equal(packageNameFromSpecifier('./local-module.js'), undefined)
})

test('collects static ESM, dynamic import, and CommonJS dependencies', () => {
  assert.deepEqual(
    sourceSpecifiers(`
      import value from 'alpha'
      const lazy = import('@scope/bravo/subpath')
      const legacy = require("charlie")
      import 'delta/register'
      const resolution = require.resolve('echo/package.json')
      export { value } from 'foxtrot'
    `),
    ['alpha', '@scope/bravo/subpath', 'charlie', 'delta/register', 'echo/package.json', 'foxtrot']
  )
})

test('accepts only non-dev package-lock entries as packaged dependencies', () => {
  const lockfile = {
    packages: {
      'node_modules/runtime': { version: '1.0.0' },
      'node_modules/dev-only': { version: '1.0.0', dev: true }
    }
  }
  assert.equal(isProductionPackage(lockfile, 'runtime'), true)
  assert.equal(isProductionPackage(lockfile, 'dev-only'), false)
  assert.equal(isProductionPackage(lockfile, 'missing'), false)
})

test('renderer-bundled-only packages pass only when every entry is dev-only', () => {
  const devOnlyLockfile = {
    packages: Object.fromEntries(
      RENDERER_BUNDLED_ONLY_PACKAGES.map((name) => [
        `node_modules/${name}`,
        { version: '0.25.1', dev: true }
      ])
    )
  }
  assert.deepEqual(rendererBundledOnlyFailures(devOnlyLockfile), [])

  const missingLockfile = { packages: {} }
  const missingFailures = rendererBundledOnlyFailures(missingLockfile)
  assert.equal(missingFailures.length, RENDERER_BUNDLED_ONLY_PACKAGES.length)
  assert.ok(missingFailures.every((failure) => failure.packageName && failure.reason))
  assert.match(formatRendererBundledOnlyError(missingFailures), /missing from package-lock\.json/u)
})

test('flags renderer-bundled-only packages that regress to production dependencies', () => {
  const [firstName, ...restNames] = RENDERER_BUNDLED_ONLY_PACKAGES
  const regressedLockfile = {
    packages: {
      [`node_modules/${firstName}`]: { version: '0.25.1' },
      ...Object.fromEntries(
        restNames.map((name) => [`node_modules/${name}`, { version: '0.25.1', dev: true }])
      )
    }
  }
  const failures = rendererBundledOnlyFailures(regressedLockfile)
  assert.deepEqual(
    failures.map((failure) => failure.packageName),
    [firstName]
  )
  assert.equal(failures[0].reason, 'listed as a production dependency')
  const message = formatRendererBundledOnlyError(failures)
  assert.ok(message.includes(`${firstName} (listed as a production dependency)`))
})
