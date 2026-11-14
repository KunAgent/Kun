#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runProcess } from './lib/kun-npm-smoke-process.mjs'
import { tarEntries } from './smoke-kun-npm.mjs'

const require = createRequire(import.meta.url)
const { parse } = require('yaml')
const options = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  assert(['--candidate', '--desktop-receipt', '--output'].includes(key) && value, 'Provide candidate, desktop-receipt and output paths')
  options[key.slice(2)] = resolve(value)
}
assert(options.candidate && options['desktop-receipt'] && options.output)
await mkdir(dirname(options.output), { recursive: true })
await writeFile(options.output, JSON.stringify({ schemaVersion: 1, kind: 'kun-npm-global-artifact-evidence',
  state: 'preflight', success: false, published: false, checks: [] }, null, 2) + '\n')
const manifest = JSON.parse(await readFile(resolve(options.candidate, 'manifest.json'), 'utf8'))
const packed = JSON.parse(tarEntries(await readFile(resolve(options.candidate, manifest.artifact.filename)))
  .find(entry => entry.name === 'package/package.json').content)
const receipt = { schemaVersion: 1, kind: 'kun-npm-global-artifact-evidence', runId: randomUUID(),
  platform: process.platform, arch: process.arch, nodeVersion: process.versions.node,
  packageName: manifest.artifact.name, packageVersion: manifest.artifact.version,
  sourceCommit: manifest.sourceCommit, buildId: packed.kunNpm.buildId,
  tarballSha256: manifest.artifact.sha256, published: false, checks: [], commands: [],
  success: false, state: 'running' }
await mkdir(dirname(options.output), { recursive: true })
const save = () => writeFile(options.output, JSON.stringify(receipt, null, 2) + '\n')
await save()
try {
  const npm = process.env.npm_execpath
  const execute = async (name, command, args, timeout) => {
    const logPath = resolve(dirname(options.output), name + '.log')
    const startedAt = new Date().toISOString()
    const result = await runProcess(command, args, { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=6144' },
      timeout, allowFailure: true })
    const log = result.stdout + result.stderr
    await writeFile(logPath, log)
    receipt.commands.push({ name, command: command + ' ' + args.join(' '), startedAt,
      finishedAt: new Date().toISOString(), exitCode: result.code, timedOut: result.timedOut,
      log: logPath, logSha256: createHash('sha256').update(log).digest('hex') })
    await save()
    assert.equal(result.code, 0, name + ': ' + log.slice(-5000))
    assert.equal(result.timedOut, false)
  }
  await execute('candidate-integrity', process.execPath, ['scripts/verify-kun-npm-candidate.mjs', options.candidate], 60_000)
  for (const script of ['test:kun:npm', 'typecheck', 'build']) {
    assert(npm, 'Launch through npm run to select its exact npm CLI')
    await execute(script.replaceAll(':', '-'), process.execPath, [npm, 'run', script], 600_000)
  }
  await execute('runtime-fence-tests', resolve('node_modules/.bin/vitest'), ['run', '--root', 'kun',
    'src/manager/turn-mutation-context.test.ts', 'src/manager/remote-data-stores.test.ts',
    'src/session/native-callback-context.test.ts'], 180_000)
  const build = JSON.parse(await readFile('kun/dist/runtime-build.json', 'utf8'))
  assert.equal(build.buildId, packed.kunNpm.buildId, 'Local validation must exercise the candidate Runtime source')
  const desktopText = await readFile(options['desktop-receipt'], 'utf8')
  const desktop = JSON.parse(desktopText)
  assert.equal(desktop.kind, 'kun-npm-supplementary-artifact-acceptance')
  assert.equal(desktop.success, true)
  assert.equal(desktop.tarballSha256, receipt.tarballSha256)
  assert.equal(desktop.buildId, receipt.buildId)
  const proof = desktop.checks.find(check => check.id === 'GUI-01.signed-packaged-cli-and-runtime')
  assert.equal(proof?.status, 'pass')
  for (const key of ['help', 'version', 'tuiDependencyGraph', 'actualTurn', 'tools', 'shutdown'])
    assert.equal(proof.detail[key], true, 'Missing packaged desktop proof: ' + key)
  assert.equal(proof.detail.signature.team, 'YBR76S5LNP')
  receipt.checks.push({ id: 'GUI-01', status: 'pass', detail: {
    validationCommands: receipt.commands.map(command => command.name),
    matchingRuntimeBuildId: build.buildId, packagedReceipt: options['desktop-receipt'],
    packagedReceiptSha256: createHash('sha256').update(desktopText).digest('hex'),
    packagedCheckId: proof.id, signatureTeam: proof.detail.signature.team } })
  const guide = await readFile('docs/kun-standalone-npm.md', 'utf8')
  for (const fragment of ['>=26.4.0 <27', '26.12.0', 'macOS', 'Windows', 'Linux', 'command -v kun',
    'where kun', 'KUN_MANAGER_CONTROL_DIR', 'KUN_MANAGER_SETTINGS_PATH', 'kun run --config',
    'kun chat --config', 'kun tui --config', 'kun serve --config', 'kun update', 'Uninstalling'])
    assert(guide.includes(fragment), 'Distribution guide is missing ' + fragment)
  const release = JSON.parse(await readFile('kun/npm/release.json', 'utf8'))
  const workflowText = await readFile('.github/workflows/kun-npm-artifact.yml', 'utf8')
  const workflow = parse(workflowText)
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.permissions.actions, 'read')
  assert.deepEqual([...workflow.jobs.install.strategy.matrix.node].sort(), [...release.testNodeVersions].sort())
  assert.deepEqual(workflow.jobs.install.strategy.matrix.target.map(target => target.id).sort(), [...release.targets].sort())
  assert(!/npm\s+(?:publish|dist-tag)|NODE_AUTH_TOKEN|NPM_TOKEN|id-token:\s*write/.test(workflowText))
  receipt.checks.push({ id: 'DOC-01', status: 'pass', detail: {
    guideSha256: createHash('sha256').update(guide).digest('hex'),
    workflowSha256: createHash('sha256').update(workflowText).digest('hex'),
    actualInstallAndConfigExamplesRequiredByNativeGate: true,
    matrixMatchesRelease: true, registryWrites: false } })
  receipt.success = true
} catch (error) {
  receipt.error = String(error.stack ?? error)
  receipt.checks.push({ id: 'global-validation', status: 'fail', detail: receipt.error })
  process.exitCode = 1
} finally {
  receipt.state = 'finished'
  await save()
  console.log('Global artifact evidence ' + (receipt.success ? 'passed: ' : 'failed: ') + options.output)
}
