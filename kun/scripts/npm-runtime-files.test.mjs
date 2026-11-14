import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { runtimeClosure } from './npm-runtime-files.mjs'

async function fixture(contents) {
  const root = await mkdtemp(join(tmpdir(), 'kun-npm-closure-'))
  for (const [name, source] of Object.entries(contents)) {
    await mkdir(dirname(join(root, name)), { recursive: true })
    await writeFile(join(root, name), source)
  }
  return root
}

test('runtime closure includes dynamic commands, worker URLs and assets but excludes unrelated evaluation code', async () => {
  const root = await fixture({
    'cli/main.js': 'import "./command.js"; const root = new URL("../../", import.meta.url);',
    'cli/command.js': 'await import("../runtime.js"); new URL("./worker.js", import.meta.url);',
    'cli/worker.js': 'new URL("../config.json", import.meta.url)',
    'runtime.js': 'import "node:fs"', 'config.json': '{}',
    'evaluation-fixtures.js': 'import "vitest"'
  })
  try {
    const files = [...await runtimeClosure(root, ['cli/main.js'])].sort()
    assert.deepEqual(files, ['cli/command.js', 'cli/main.js', 'cli/worker.js', 'config.json', 'runtime-build.json', 'runtime.js'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing module and development helpers cannot silently enter a runtime closure', async () => {
  const root = await fixture({ 'main.js': 'await import("./missing.js")' })
  try {
    await assert.rejects(runtimeClosure(root, ['main.js']), /Missing emitted Runtime resource/)
    await writeFile(join(root, 'main.js'), 'import "./runtime-test-support.js"')
    await writeFile(join(root, 'runtime-test-support.js'), '')
    await assert.rejects(runtimeClosure(root, ['main.js']), /development-only file/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
