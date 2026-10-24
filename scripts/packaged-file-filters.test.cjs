'use strict'

const assert = require('node:assert/strict')
const { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const projectDir = join(__dirname, '..')

function packKunModules(t, packageNames) {
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher')
  const builderConfig = require('../electron-builder.config.cjs')
  const destination = mkdtempSync(join(tmpdir(), 'kun-file-filter-test-'))
  t.after(() => rmSync(destination, { recursive: true, force: true }))
  const [matcher] = getMainFileMatchers(projectDir, destination, (value) => value, {}, {
    info: {
      projectDir,
      buildResourcesDir: 'build',
      config: { ...builderConfig, files: [...builderConfig.files] },
      isPrepackedAppAsar: false,
      debugLogger: { isEnabled: false }
    }
  }, join(projectDir, 'dist'), false)
  const filter = matcher.createFilter()
  for (const name of packageNames) {
    cpSync(
      join(projectDir, 'kun', 'node_modules', name),
      join(destination, 'kun', 'node_modules', name),
      { recursive: true, filter: (path) => filter(path, statSync(path)) }
    )
  }
  return {
    source: (name, ...parts) => join(projectDir, 'kun', 'node_modules', name, ...parts),
    packed: (name, ...parts) => join(destination, 'kun', 'node_modules', name, ...parts)
  }
}

test('drops opentui Bun-only builds while keeping the Node entry chain', (t) => {
  const { source, packed } = packKunModules(t, ['@opentui/core', '@opentui/solid'])
  const coreFiles = readdirSync(source('@opentui/core'))
  const bunChunks = coreFiles.filter((name) => /^chunk-bun-.*\.js$/.test(name))
  const nodeChunks = coreFiles.filter((name) => /^chunk-node-.*\.js$/.test(name))
  assert.ok(bunChunks.length > 0 && nodeChunks.length > 0)
  for (const name of [...bunChunks, 'index.bun.js', 'testing.bun.js', 'yoga.bun.js']) {
    assert.equal(existsSync(source('@opentui/core', name)), true, name)
    assert.equal(existsSync(packed('@opentui/core', name)), false, name)
  }
  assert.equal(existsSync(packed('@opentui/solid', 'index.bun.js')), false)
  for (const name of [...nodeChunks, 'index.node.js', 'parser.worker.js', 'package.json']) {
    assert.equal(existsSync(packed('@opentui/core', name)), true, name)
  }
  for (const name of ['index.js', 'jsx-runtime.js', 'components.js', 'package.json']) {
    assert.equal(existsSync(packed('@opentui/solid', name)), true, name)
  }
  assert.equal(existsSync(packed('@opentui/core', 'assets')), true)
})

test('keeps the web-tree-sitter runtime opentui loads and drops debug and C sources', async (t) => {
  const { source, packed } = packKunModules(t, ['web-tree-sitter', '@opentui/core'])
  for (const directory of ['debug', 'lib']) {
    assert.equal(existsSync(source('web-tree-sitter', directory)), true, directory)
    assert.equal(existsSync(packed('web-tree-sitter', directory)), false, directory)
  }
  // Exercise the retained copy in isolation, without source-tree fallback.
  const { Parser, Language } = require(packed('web-tree-sitter', 'tree-sitter.cjs'))
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(
    packed('@opentui/core', 'assets', 'javascript', 'tree-sitter-javascript.wasm')
  ))
  assert.equal(parser.parse('const answer = 42').rootNode.type, 'program')
})

test('drops ESM and CJS declaration twins but keeps the matching runtime modules', (t) => {
  const { source, packed } = packKunModules(t, ['@modelcontextprotocol/client'])
  const distFiles = readdirSync(source('@modelcontextprotocol/client', 'dist'))
  const declarations = distFiles.filter((name) => /\.d\.[cm]ts$/.test(name))
  const runtimes = distFiles.filter((name) => /\.[cm]js$/.test(name))
  assert.ok(declarations.length > 0 && runtimes.length > 0)
  for (const name of declarations) {
    assert.equal(existsSync(packed('@modelcontextprotocol/client', 'dist', name)), false, name)
  }
  for (const name of runtimes) {
    assert.equal(existsSync(packed('@modelcontextprotocol/client', 'dist', name)), true, name)
  }
})
