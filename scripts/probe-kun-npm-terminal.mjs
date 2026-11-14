#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { startFixtureModel } from './lib/kun-npm-smoke-model.mjs'
import { artifactProfile } from './lib/kun-npm-artifact-runtime.mjs'
import { removeSmokeFixture, runProcess } from './lib/kun-npm-smoke-process.mjs'

const [directory, output] = process.argv.slice(2)
assert(directory && output, 'Usage: probe-kun-npm-terminal.mjs ARTIFACT_DIRECTORY RECEIPT')
const candidate = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
const tarball = join(directory, candidate.artifact.filename)
assert.equal(createHash('sha256').update(await readFile(tarball)).digest('hex'), candidate.artifact.sha256)
const root = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'kun-terminal-probe-'))
const receipt = { schemaVersion: 1, kind: 'kun-npm-terminal-diagnostic', node: process.versions.node,
  artifactSourceCommit: candidate.sourceCommit, driverSourceCommit: process.env.GITHUB_SHA,
  tarballSha256: candidate.artifact.sha256, checks: [], success: false,
  scope: 'Diagnostic extraction; does not replace real npm project/global install acceptance' }
let model
try {
  execFileSync('tar', ['-xzf', resolve(tarball), '-C', root])
  model = await startFixtureModel()
  const context = { root, node: process.execPath, model }
  if (process.platform === 'win32') {
    const probe = await runProcess('python', [fileURLToPath(new URL('./fixtures/kun-npm/windows_conpty.py', import.meta.url)), process.execPath])
    console.log(probe.stdout)
    receipt.ttyHandles = JSON.parse(probe.stdout.trim().split('\n').findLast(line => line.startsWith('{')))
  }
  for (const mode of ['tui', 'bare', 'cancel']) {
    const profile = await artifactProfile(context, mode)
    const runner = fileURLToPath(new URL('./fixtures/kun-npm/tui-pty.py', import.meta.url))
    const result = await runProcess(process.platform === 'win32' ? 'python' : 'python3', [runner,
      process.execPath, join(root, 'package/bin/kun.mjs'), profile.env.KUN_DATA_DIR, profile.workspace, mode],
    { cwd: root, env: { ...profile.env, KUN_CONFIG: profile.config }, timeout: 90_000, allowFailure: true })
    let value
    try { value = JSON.parse(result.stdout) } catch { value = { stderr: result.stderr, stdout: result.stdout } }
    receipt.checks.push({ mode, result: value, wrapperExit: result.code })
    console.log(JSON.stringify({ mode, result: value }))
    await mkdir(dirname(resolve(output)), { recursive: true })
    await writeFile(output, JSON.stringify(receipt, null, 2) + '\n')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(value.exitCode, 0, JSON.stringify(value))
    assert(!value.forcedExit && value.sentPrompt && value.quitSubmitted, JSON.stringify(value))
    assert(mode === 'cancel' ? value.cancellationVerified : value.matchedReply, JSON.stringify(value))
  }
  receipt.success = true
} catch (error) { receipt.error = String(error.stack ?? error); console.error(receipt.error); process.exitCode = 1 }
finally {
  await model?.close()
  await removeSmokeFixture(root)
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n')
}
