import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { inspectNpm } from './npm-inspect.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-npm-inspect-'))
  const lock = JSON.stringify({ version: '1.0.0', packages: { '': {} } })
  const manifest = {
    name: '@kun/agent', version: '1.0.0', bin: { kun: 'bin/kun.mjs' }, engines: { node: '>=26.4.0 <27' },
    dependencies: {}, bundleDependencies: [],
    kunNpm: { kind: 'npm', buildId: 'fixture', lockSha256: createHash('sha256').update(lock).digest('hex') }
  }
  const contents = {
    'package.json': JSON.stringify(manifest), 'npm-shrinkwrap.json': lock,
    'dist/runtime-build.json': JSON.stringify({ serviceVersion: '1.0.0', buildId: 'fixture' }),
    'bin/kun.mjs': '#!/usr/bin/env node\n', 'dist/cli/serve-entry.js': 'import("./serve-main.js")',
    'dist/cli/serve-main.js': '', 'dist/manager/manager-entry.js': '', 'dist/tui/app/main.js': '',
    LICENSE: 'fixture', 'THIRD-PARTY-NOTICES.txt': 'fixture', 'README.md': 'fixture'
  }
  for (const [name, text] of Object.entries(contents)) {
    await mkdir(dirname(join(root, name)), { recursive: true })
    await writeFile(join(root, name), text, { mode: name === 'bin/kun.mjs' ? 0o755 : 0o644 })
  }
  return root
}

test('inspector validates a closed payload and rejects a missing dynamic child entry', async () => {
  const root = await fixture()
  try {
    assert.equal((await inspectNpm(root)).runtimeFiles, 5)
    await writeFile(join(root, 'dist/cli/serve-main.js'), 'await import("../missing-worker.js")')
    await assert.rejects(inspectNpm(root), /Missing runtime import/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('inspector rejects development residue in the runtime payload', async () => {
  const root = await fixture()
  try {
    await writeFile(join(root, 'dist/cli/fixture-test-support.js'), '')
    await assert.rejects(inspectNpm(root), /Development runtime file/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
