#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DRIVER_FILES = [
  'scripts/smoke-kun-npm.mjs', 'scripts/run-kun-npm-artifact-smoke.mjs',
  'scripts/lib/kun-npm-artifact-runtime.mjs', 'scripts/lib/kun-npm-artifact-lifecycle.mjs',
  ...['process', 'model', 'server', 'integrations', 'windows'].map(name => `scripts/lib/kun-npm-smoke-${name}.mjs`),
  ...['tui-pty.py', 'posix_terminal.py', 'windows_conpty.py', 'mcp-server.mjs',
    'lifecycle-process.mjs', 'observe-listeners.mjs', 'windows_processes.py',
    'windows-helper-probe.mjs'].map(name => `scripts/fixtures/kun-npm/${name}`)
]

export async function exportDriver(checkout, output, sourceCommit) {
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'Export requires the exact source commit')
  const files = {}
  await mkdir(output, { recursive: false })
  for (const name of DRIVER_FILES) {
    const source = join(checkout, name)
    assert((await lstat(source)).isFile(), `Driver input cannot be a link: ${name}`)
    const target = join(output, name)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    files[name] = createHash('sha256').update(await readFile(target)).digest('hex')
  }
  await writeFile(join(output, 'driver-manifest.json'), JSON.stringify({ schemaVersion: 1, sourceCommit, files }, null, 2) + '\n')
  return { files: Object.keys(files).length, output }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [output, ...extra] = process.argv.slice(2)
  assert(output && !extra.length, 'Usage: export-kun-npm-test-driver.mjs OUTPUT')
  console.log(JSON.stringify(await exportDriver(process.cwd(), resolve(output), process.env.GITHUB_SHA)))
}
