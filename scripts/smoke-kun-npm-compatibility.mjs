#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tarEntries } from './smoke-kun-npm.mjs'
import { guardCompilers, locateNpm, removeSmokeFixture, runProcess, smokeEnvironment } from './lib/kun-npm-smoke-process.mjs'
import { startFixtureModel } from './lib/kun-npm-smoke-model.mjs'
import { exerciseArtifactLifecycle } from './lib/kun-npm-artifact-lifecycle.mjs'
import { treeHashes } from './lib/kun-npm-artifact-runtime.mjs'
import { nativeReceipts } from './lib/kun-npm-release-artifacts.mjs'
import { checkMatrix } from './check-kun-npm-matrix.mjs'

export function parseGateArguments(argv) {
  const options = { only: ['lifecycle', 'history', 'desktop'] }
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === '--keep-work') { options.keepWork = true; continue }
    if (key === '--materialize-archive') { options.materializeArchive = true; continue }
    if (key === '--ci-data-desktop') { options.ciDataDesktop = true; continue }
    assert(['--tarball', '--output', '--node', '--historical-resources', '--desktop-resources', '--only', '--native-receipts'].includes(key), `Unknown argument: ${key}`)
    const value = argv[++index]
    assert(value && !value.startsWith('--'), `Missing value for ${key}`)
    options[key.slice(2)] = key === '--only' ? value.split(',') : resolve(value)
  }
  assert(options.tarball && options.output, 'Usage: smoke-kun-npm-compatibility.mjs --tarball FILE --output RECEIPT [--only lifecycle,history,desktop]')
  assert(options.only.length && options.only.every(value => ['lifecycle', 'history', 'desktop'].includes(value)), 'Invalid acceptance stage')
  if (options.materializeArchive) assert(options['native-receipts'], 'Archive materialization requires actual native npm installation receipts')
  return options
}

export async function runGateAcceptance(options) {
  const runId = randomUUID()
  try { return await runCoreAcceptance({ ...options, runId }) }
  catch (error) {
    await mkdir(dirname(options.output), { recursive: true })
    await writeFile(options.output, JSON.stringify({ schemaVersion: 1, runId,
      kind: 'kun-npm-supplementary-artifact-acceptance', success: false, gateAComplete: false,
      state: 'failed-preflight', checks: [{ id: 'artifact-preflight', status: 'fail', detail: String(error.stack ?? error) }] }, null, 2) + '\n')
    throw error
  }
}

async function runCoreAcceptance(options) {
  const node = options.node ?? process.execPath
  const nodeVersion = (await runProcess(node, ['--version'])).stdout.trim().replace(/^v/, '')
  assert(/^26\./.test(nodeVersion) && Number(nodeVersion.split('.')[1]) >= 4, 'Use Node >=26.4 <27')
  const archive = await readFile(options.tarball)
  const manifest = JSON.parse(tarEntries(archive).find(entry => entry.name === 'package/package.json').content)
  const workBase = process.env.KUN_NPM_SMOKE_ROOT?.trim() || tmpdir()
  await mkdir(workBase, { recursive: true })
  const root = await mkdtemp(join(workBase, 'kun-npm-gate-a-'))
  const receipt = { schemaVersion: 1, runId: options.runId, kind: 'kun-npm-supplementary-artifact-acceptance',
    platform: process.platform, arch: process.arch, os: release(), nodeVersion,
    packageName: manifest.name, packageVersion: manifest.version, buildId: manifest.kunNpm.buildId,
    sourceCommit: manifest.kunNpm.sourceCommit, sourceDirty: manifest.kunNpm.sourceDirty,
    tarballSha256: createHash('sha256').update(archive).digest('hex'),
    workDirectory: root, stages: options.only, checks: [], success: false, gateAComplete: false }
  const context = { root, node, options, receipt, manifest, modelOptions: {} }
  await mkdir(dirname(options.output), { recursive: true })
  receipt.state = 'running'
  await writeFile(options.output, JSON.stringify(receipt, null, 2) + '\n')
  context.check = async (id, operation) => {
    process.stdout.write(`[gate-a] ${id}\n`)
    const start = Date.now()
    try {
      const detail = await operation()
      receipt.checks.push({ id, status: 'pass', durationMs: Date.now() - start, detail })
      await writeFile(options.output, JSON.stringify(receipt, null, 2) + '\n')
      return detail
    } catch (error) {
      receipt.checks.push({ id, status: 'fail', durationMs: Date.now() - start, detail: String(error.stack ?? error) })
      await writeFile(options.output, JSON.stringify(receipt, null, 2) + '\n')
      throw error
    }
  }
  try {
    const prefix = join(root, 'installed prefix')
    await mkdir(prefix)
    const candidate = join(root, 'candidate.tgz')
    await writeFile(candidate, archive)
    const env = smokeEnvironment(node, root)
    env.KUN_NPM_COMPILER_AUDIT = await guardCompilers(root)
    const npm = locateNpm(node)
    await context.check(options.materializeArchive ? 'ARTIFACT-01.verified-archive-materialization' : 'NPM-01.supplementary-install', async () => {
      if (options.materializeArchive) {
        const values = (await nativeReceipts(options['native-receipts'])).map(item => item.value)
        const release = JSON.parse(await readFile('kun/npm/release.json', 'utf8'))
        assert(values.every(value => value.tarballSha256 === receipt.tarballSha256))
        assert(checkMatrix(values, release, { complete: false }).success, 'Actual native installation matrix must pass before local archive regression')
        await runProcess('tar', ['-xzf', candidate, '-C', prefix], { cwd: root, env, timeout: 600_000 })
        receipt.materialization = { method: 'verified-original-tarball', nativeNpmInstallReceipts: values.length,
          note: 'Local desktop/data supplement; actual npm install and uninstall remain verified by the complete native matrix.' }
      } else await runProcess(node, [npm, 'install', '--global', '--prefix', prefix, '--cache', join(root, 'npm-cache'),
        '--offline', '--engine-strict', '--omit=dev', '--no-audit', '--no-fund', candidate],
      { cwd: root, env, timeout: 600_000 })
      const installedRoot = options.materializeArchive ? join(prefix, 'package') :
        join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', ...manifest.name.split('/'))
      context.installed = { root: installedRoot, entry: join(installedRoot, 'bin/kun.mjs') }
      const actual = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
      assert.equal(actual.kunNpm.buildId, manifest.kunNpm.buildId)
      assert(!await access(env.KUN_NPM_COMPILER_AUDIT).then(() => true, () => false), 'Installation invoked a compiler')
      context.launch = { command: node, args: [context.installed.entry] }
    })
    context.model = await startFixtureModel(context.modelOptions)
    for (const stage of options.only) {
      try {
        if (stage === 'lifecycle') await exerciseArtifactLifecycle(context)
        if (stage === 'history') await (await import('./lib/kun-npm-artifact-history.mjs')).exerciseArtifactHistory(context)
        if (stage === 'desktop') await (await import('./lib/kun-npm-artifact-desktop.mjs')).exerciseArtifactDesktop(context)
      } catch (error) {
        receipt.stageErrors ??= {}
        receipt.stageErrors[stage] = String(error.stack ?? error)
        process.stderr.write(`[gate-a] ${stage}: ${error.message}\n`)
      }
    }
    if (context.historyProfile && !receipt.stageErrors) await context.check(options.materializeArchive
      ? 'DATA-02.remove-materialized-package-preserves-history' : 'DATA-02.uninstall-after-history-upgrade', async () => {
      const profile = context.historyProfile
      const before = await treeHashes(profile.env.KUN_DATA_DIR)
      const settings = await readFile(profile.env.KUN_MANAGER_SETTINGS_PATH, 'utf8')
      if (options.materializeArchive) await removeSmokeFixture(context.installed.root)
      else await runProcess(node, [npm, 'uninstall', '--global', '--prefix', prefix, '--cache', join(root, 'npm-cache'),
        '--offline', '--no-audit', '--no-fund', manifest.name], { cwd: root, env, timeout: 90_000 })
      assert.deepEqual(await treeHashes(profile.env.KUN_DATA_DIR), before)
      assert.equal(await readFile(profile.env.KUN_MANAGER_SETTINGS_PATH, 'utf8'), settings)
      assert(!await access(context.installed.entry).then(() => true, () => false))
      return { unchangedDataFiles: Object.keys(before).length, settingsPreserved: true }
    })
    receipt.success = !receipt.stageErrors && receipt.checks.every(check => check.status === 'pass')
  } catch (error) { receipt.error = String(error.stack ?? error) }
  finally {
    try { await context.model?.close(); if (!options.keepWork) await removeSmokeFixture(root) }
    catch (error) { receipt.success = false; receipt.cleanupError = String(error.stack ?? error) }
    receipt.state = 'finished'
    await writeFile(options.output, JSON.stringify(receipt, null, 2) + '\n')
  }
  return receipt
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const receipt = await runGateAcceptance(parseGateArguments(process.argv.slice(2)))
    process.stdout.write(`Local supplementary acceptance ${receipt.success ? 'passed' : 'failed'}: ${receipt.stages.join(', ')}\n`)
    if (!receipt.success) process.exitCode = 1
  } catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1 }
}
