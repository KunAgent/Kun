'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, relative, sep } = require('node:path')
const test = require('node:test')
const { deflateRawSync } = require('node:zlib')
const {
  getMainFileMatchers, getNodeModuleFileMatcher
} = require('app-builder-lib/out/fileMatcher')
const builderConfig = require('../electron-builder.config.cjs')

const PROJECT_DIR = join(__dirname, '..')
const XLSX_BROWSER_FILES = [
  'dist/xlsx.core.min.js',
  'dist/xlsx.full.min.js',
  'dist/xlsx.mini.min.js',
  'dist/xlsx.extendscript.js'
]
const DOCX_BROWSER_FILES = [
  'dist/html-to-docx.browser.js',
  'dist/html-to-docx.browser.esm.js'
]

function fixture(t) {
  const destination = mkdtempSync(join(tmpdir(), 'kun-office-payload-test-'))
  t.after(() => rmSync(destination, { recursive: true, force: true }))
  const packager = {
    projectDir: PROJECT_DIR,
    buildResourcesDir: 'build',
    config: { ...builderConfig, files: [...builderConfig.files] },
    isPrepackedAppAsar: false,
    debugLogger: { isEnabled: false }
  }
  const [mainMatcher] = getMainFileMatchers(
    PROJECT_DIR, destination, (value) => value, {}, { info: packager },
    join(PROJECT_DIR, 'dist'), false
  )
  const dependencyMatcher = getNodeModuleFileMatcher(
    PROJECT_DIR, destination, (value) => value, {}, packager
  )
  const mainFilter = mainMatcher.createFilter()
  const dependencyFilter = dependencyMatcher.createFilter()
  const copyPackage = (source) => {
    const path = relative(PROJECT_DIR, source)
    const target = join(destination, path)
    const filter = path.startsWith(`kun${sep}`)
      ? mainFilter : dependencyFilter
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, {
      recursive: true,
      filter: (file) => filter(file, statSync(file))
    })
    return target
  }
  return { destination, copyPackage }
}

function assertRetained(source, packed, paths) {
  for (const path of paths) {
    assert.deepEqual(readFileSync(join(packed, path)), readFileSync(join(source, path)), path)
  }
}

function assertExcluded(t, source, packed, paths) {
  let rawBytes = 0
  let deflateBytes = 0
  for (const path of paths) {
    const contents = readFileSync(join(source, path))
    rawBytes += contents.length
    deflateBytes += deflateRawSync(contents, { level: 9 }).length
    assert.equal(existsSync(join(packed, path)), false, path)
  }
  // ZIP uses per-file deflate level 9. This measures the excluded dependency
  // payload, not the final signed macOS DMG/ZIP, which remains a native CI gate.
  t.diagnostic(`Excluded ${rawBytes} raw bytes; ${deflateBytes} deflate bytes`)
}

function runIsolated(cwd, source) {
  // The temporary directory is outside the source tree. Neither ESM nor CJS
  // resolution can silently fall back to the checkout's unfiltered packages.
  execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd,
    env: { ...process.env, NODE_PATH: '' },
    encoding: 'utf8',
    timeout: 30_000
  })
}

for (const location of ['node_modules', 'kun/node_modules']) {
  test(`trims only unused SheetJS bundles from ${location}`, (t) => {
    const { destination, copyPackage } = fixture(t)
    const source = join(PROJECT_DIR, location, 'xlsx')
    const packed = copyPackage(source)
    assertExcluded(t, source, packed, XLSX_BROWSER_FILES)
    assertRetained(source, packed, [
      'package.json', 'LICENSE', 'dist/LICENSE', 'xlsx.js', 'xlsx.mjs',
      'dist/cpexcel.js', 'dist/cpexcel.full.mjs',
      'dist/xlsx.zahl.js', 'dist/xlsx.zahl.mjs', 'bin/xlsx.njs'
    ])
    runIsolated(location.startsWith('kun/') ? join(destination, 'kun') : destination, `
      import assert from 'node:assert/strict'
      import { createRequire } from 'node:module'
      import * as xlsx from 'xlsx'
      import * as codepage from 'xlsx/dist/cpexcel.full.mjs'
      const require = createRequire(import.meta.url)
      const commonjs = require('xlsx')
      xlsx.set_cptable(codepage)
      for (const api of [xlsx, commonjs]) {
        const workbook = api.utils.book_new()
        const sheet = api.utils.aoa_to_sheet([['Label', 'Value'], ['caf\\u00e9', 42]])
        api.utils.book_append_sheet(workbook, sheet, 'Data')
        for (const bookType of ['xlsx', 'biff8']) {
          const bytes = api.write(workbook, { type: 'buffer', bookType, codepage: 1252 })
          const read = api.read(bytes, { type: 'buffer', codepage: 1252 })
          assert.equal(read.Sheets.Data.A2.v, 'caf\\u00e9')
          assert.equal(read.Sheets.Data.B2.v, 42)
        }
        const legacyCsv = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])
        const read = api.read(legacyCsv, { type: 'buffer', codepage: 1252 })
        assert.equal(read.Sheets[read.SheetNames[0]].A1.v, 'caf\\u00e9')
      }
    `)
  })
}

function dependencyRoot(issuer, name) {
  let directory = issuer
  while (directory.startsWith(PROJECT_DIR)) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (directory === PROJECT_DIR) break
    directory = dirname(directory)
  }
  throw new Error(`Missing installed dependency ${name} required by ${issuer}`)
}

function copyDependencyClosure(copyPackage, source, seen = new Set()) {
  if (seen.has(source)) return
  seen.add(source)
  copyPackage(source)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  for (const name of Object.keys(manifest.dependencies || {})) {
    copyDependencyClosure(copyPackage, dependencyRoot(source, name), seen)
  }
}

test('trims DOCX browser bundles while preserving the licensed Node exporter', (t) => {
  const { destination, copyPackage } = fixture(t)
  const source = join(PROJECT_DIR, 'node_modules', 'html-to-docx')
  const packed = join(destination, 'node_modules', 'html-to-docx')
  copyDependencyClosure(copyPackage, source)
  assertExcluded(t, source, packed, DOCX_BROWSER_FILES)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  assertRetained(source, packed, ['package.json', 'LICENSE', manifest.main, manifest.module])
  runIsolated(destination, `
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    const htmlToDocx = require('html-to-docx')
    const JSZip = require('jszip')
    const bytes = await htmlToDocx('<h1>Packaged export</h1><p>caf\\u00e9</p>')
    const archive = await JSZip.loadAsync(bytes)
    const document = await archive.file('word/document.xml').async('string')
    assert.match(document, /Packaged export/)
    assert.match(document, /caf\\u00e9/)
    assert.ok(archive.file('[Content_Types].xml'))
  `)
})
