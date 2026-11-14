#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { runProcess, locateNpm } from './lib/kun-npm-smoke-process.mjs'
import { tarEntries } from './smoke-kun-npm.mjs'

const [candidate, output, ...extra] = process.argv.slice(2)
assert(candidate && output && !extra.length, 'Usage: run-kun-npm-build-validation.mjs CANDIDATE_DIRECTORY RECEIPT')
await mkdir(dirname(resolve(output)), { recursive: true })
const manifest = JSON.parse(await readFile(resolve(candidate, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(tarEntries(await readFile(resolve(candidate, manifest.artifact.filename)))
  .find(entry => entry.name === 'package/package.json').content)
const receipt = { schemaVersion: 1, kind: 'kun-npm-build-validation', success: false, state: 'running',
  packageName: pkg.name, packageVersion: pkg.version, sourceCommit: manifest.sourceCommit,
  validationSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  buildId: pkg.kunNpm.buildId, tarballSha256: manifest.artifact.sha256, commands: [], published: false }
const save = () => writeFile(resolve(output), JSON.stringify(receipt, null, 2) + '\n')
await save()
try {
  const execute = async (name, command, args, timeout) => {
    const log = resolve(dirname(output), name + '.log')
    const startedAt = new Date().toISOString()
    const result = await runProcess(command, args, { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=6144' },
      timeout, allowFailure: true })
    const text = result.stdout + result.stderr
    await writeFile(log, text)
    receipt.commands.push({ name, command: command + ' ' + args.join(' '), startedAt,
      finishedAt: new Date().toISOString(), exitCode: result.code, timedOut: result.timedOut,
      log, logSha256: createHash('sha256').update(text).digest('hex') })
    await save()
    assert.equal(result.code, 0, name + ': ' + text.slice(-3000))
    assert.equal(result.timedOut, false)
  }
  await execute('candidate-integrity', process.execPath, ['scripts/verify-kun-npm-candidate.mjs', resolve(candidate)], 60_000)
  const npm = locateNpm(process.execPath)
  for (const name of ['test:kun:npm', 'typecheck', 'build'])
    await execute(name.replaceAll(':', '-'), process.execPath, [npm, 'run', name], 1_800_000)
  await execute('runtime-fence-tests', resolve('node_modules/.bin/vitest'), ['run', '--root', 'kun',
    'src/manager/turn-mutation-context.test.ts', 'src/manager/remote-data-stores.test.ts',
    'src/session/native-callback-context.test.ts'], 180_000)
  const build = JSON.parse(await readFile('kun/dist/runtime-build.json', 'utf8'))
  assert.equal(build.buildId, receipt.buildId)
  receipt.success = true
} catch (error) {
  receipt.error = String(error.stack ?? error)
  process.exitCode = 1
} finally { receipt.state = 'finished'; await save() }
