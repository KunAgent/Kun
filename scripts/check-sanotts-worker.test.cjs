'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { checkSanottsWorker } = require('./check-sanotts-worker.cjs')

test('rejects an unpacked entry missing a transitive shared chunk', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kun-worker-closure-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const entry = join(root, 'worker.js')
  mkdirSync(join(root, 'chunks'))
  writeFileSync(entry, "import './chunks/shared.js';")
  writeFileSync(join(root, 'chunks/shared.js'), "export { x } from './nested.js';")
  assert.throws(() => checkSanottsWorker(entry), /ENOENT/)
  writeFileSync(join(root, 'chunks/nested.js'), 'export const x = 1;')
  assert.equal(checkSanottsWorker(entry).length, 3)
})
