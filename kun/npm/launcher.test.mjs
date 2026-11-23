import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { npmStartupError, isTuiInvocation } from './bin/kun.mjs'

test('npm interpreter and target preflight matches the declared distribution range', () => {
  for (const value of ['22.19.0', '26.3.9', '27.0.0', 'invalid']) assert.match(npmStartupError(value, 'darwin', 'arm64'), /26.4.0 <27/)
  for (const value of ['26.4.0', '26.12.0']) assert.equal(npmStartupError(value, 'darwin', 'arm64'), undefined)
  for (const [platform, arch, glibc] of [['linux', 'arm64', false], ['win32', 'arm64', true], ['freebsd', 'x64', true]]) {
    assert.match(npmStartupError('26.12.0', platform, arch, glibc), /does not support/)
  }
})

test('only terminal invocations require the FFI handoff', () => {
  for (const args of [[], ['tui'], ['--workspace', '/tmp']]) assert.equal(isTuiInvocation(args), true)
  for (const args of [['run', 'hi'], ['serve'], ['--version'], ['--help']]) assert.equal(isTuiInvocation(args), false)
})

test('version, help and npm update do not import the Runtime or write a profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun npm launcher '))
  try {
    await mkdir(join(root, 'bin'))
    await mkdir(join(root, 'dist/cli'), { recursive: true })
    await copyFile(new URL('./bin/kun.mjs', import.meta.url), join(root, 'bin/kun.mjs'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/kun', version: '0.4.5', type: 'module', kunNpm: { kind: 'npm' } }))
    await writeFile(join(root, 'dist/cli/serve-entry.js'), 'throw new Error("Runtime must not load")')
    await writeFile(join(root, 'dist/cli/kun-cli-command.js'), 'export const KUN_CLI_USAGE = "kun <command>"')
    await writeFile(join(root, 'version.mjs'), 'Object.defineProperty(process.versions, "node", { value: "26.12.0" })')
    for (const args of [['--version'], ['--help'], ['update', '--check'], ['update', '--yes']]) {
      const result = spawnSync(process.execPath, ['--import', join(root, 'version.mjs'), join(root, 'bin/kun.mjs'), ...args], { encoding: 'utf8', timeout: 10_000 })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      assert.match(result.stdout, /@fixture\/kun/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
