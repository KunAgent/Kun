'use strict'

const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const {
  packageNameFromSpecifier,
  sourceSpecifiers,
  isProductionPackage,
  checkKunRuntimeDependencies,
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

test('collects esbuild-minified ESM imports without whitespace around from', () => {
  assert.deepEqual(
    sourceSpecifiers(
      'import{app as a}from"electron";import"side-effect/pkg";export{x}from"re-export/pkg";'
    ),
    ['electron', 'side-effect/pkg', 're-export/pkg']
  )
})

test('filters import/export keywords inside string and regex literals', () => {
  const raw = sourceSpecifiers(
    'const k="import";x=kind==="import"?1:0;x.handle("write:export",()=>{});' +
      'x="before export";const r=/^(?:export\\s+)?function/;const q=/^import\\s+[\'"]/'
  )
  assert.deepEqual(raw.map(packageNameFromSpecifier).filter(Boolean), [])
})

test('rejects specifiers that are not valid npm package names', () => {
  assert.equal(packageNameFromSpecifier(');const w=e.categories.includes('), undefined)
  assert.equal(packageNameFromSpecifier(',async(p,m)=>oae(D('), undefined)
  assert.equal(packageNameFromSpecifier('zod'), 'zod')
  assert.equal(packageNameFromSpecifier('@scope/name/subpath'), '@scope/name')
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

function writeTree(root, relativePath, contents) {
  const path = join(root, ...relativePath.split('/'))
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

function createKunRoot({ installed = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kun-runtime-deps-'))
  writeTree(
    root,
    'kun/dist/cli/serve-entry.js',
    "import { omega } from 'omega'\nexport * from './serve.js'\n"
  )
  writeTree(root, 'kun/dist/cli/serve.js', 'export const serve = 1\n')
  writeTree(root, 'kun/dist/cli/agent-cli.js', 'export const run = 1\n')
  writeTree(root, 'kun/dist/cli/index.js', 'export const cli = 1\n')
  writeTree(root, 'kun/dist/manager/manager-entry.js', 'export const manager = 1\n')
  if (installed) writeTree(root, 'kun/node_modules/omega/package.json', '{"name":"omega"}')
  return root
}

test('resolves every package the compiled Kun runtime imports', () => {
  const root = createKunRoot()
  try {
    const result = checkKunRuntimeDependencies({ root })
    assert.deepEqual(result.packages, ['omega'])
    assert.ok(result.reachableFiles >= 5)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts root-hoisted packages that after-pack keeps on disk', () => {
  const root = createKunRoot({ installed: false })
  try {
    writeTree(root, 'node_modules/omega/package.json', '{"name":"omega"}')
    assert.deepEqual(checkKunRuntimeDependencies({ root }).packages, ['omega'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails when the compiled Kun runtime imports an uninstalled package', () => {
  const root = createKunRoot({ installed: false })
  try {
    assert.throws(() => checkKunRuntimeDependencies({ root }), /not installed:\n- omega/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails when a compiled module imports a file that was not emitted', () => {
  const root = createKunRoot()
  try {
    rmSync(join(root, 'kun', 'dist', 'cli', 'serve.js'))
    assert.throws(() => checkKunRuntimeDependencies({ root }), /were not emitted/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ignores test-support modules that the runtime never loads', () => {
  const root = createKunRoot()
  try {
    writeTree(root, 'kun/dist/server/unused-test-support.js', "import { vi } from 'vitest'\n")
    assert.deepEqual(checkKunRuntimeDependencies({ root }).packages, ['omega'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
