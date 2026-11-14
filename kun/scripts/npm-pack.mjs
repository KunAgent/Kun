import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureSafeOutput, json, writeJson } from './npm-files.mjs'
import { inspectNpm } from './npm-inspect.mjs'
import { repository, stageNpm } from './npm-stage.mjs'

export function npmCommand(args, options) {
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  try { candidates.push(join(dirname(createRequire(import.meta.url).resolve('npm/package.json')), 'bin/npm-cli.js')) }
  catch { /* Official Node archives contain npm beside their interpreter. */ }
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const executable = join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm')
    if (!existsSync(executable)) continue
    if (process.platform === 'win32') candidates.push(join(directory, 'node_modules/npm/bin/npm-cli.js'))
    else candidates.push(realpathSync(executable))
  }
  const cli = candidates.find((path) => path?.endsWith('.js') && existsSync(path))
  assert(cli, 'Cannot locate npm-cli.js; run the packaging script through npm run or an official Node installation')
  return execFileSync(process.execPath, [cli, ...args], options)
}

export async function packNpm(options = {}) {
  const output = resolve(options.output ?? join(repository, '.cache/kun-npm/artifacts'))
  await ensureSafeOutput(output, repository)
  await mkdir(output, { recursive: true })
  const stage = options.stage ? { directory: resolve(options.stage) }
    : await stageNpm({ output: join(dirname(output), 'package'), name: options.name,
      windowsPayload: options.windowsPayload })
  const inspection = await inspectNpm(stage.directory)
  const manifest = await json(join(stage.directory, 'package.json'))
  const artifacts = []
  for (const name of manifest.bundleDependencies.filter((name) => name === manifest.kunNpm.windowsPackage)) {
    artifacts.push(await packDirectory(join(stage.directory, 'node_modules', name), output))
  }
  const artifact = await packDirectory(stage.directory, output)
  const unpack = await mkdtemp(join(tmpdir(), 'kun-npm-packed-'))
  let packedInspection
  try {
    execFileSync('tar', ['-xzf', artifact.absolutePath, '-C', unpack])
    packedInspection = await inspectNpm(join(unpack, 'package'))
  } finally { await rm(unpack, { recursive: true, force: true }) }
  const receipt = { schemaVersion: 1, kind: 'kun-npm-local-candidate', published: false,
    target: `${process.platform}-${process.arch}`, node: process.versions.node,
    name: inspection.name, version: inspection.version, sourceCommit: inspection.sourceCommit,
    sourceDirty: inspection.sourceDirty,
    lockSha256: manifest.kunNpm.lockSha256, inspection: packedInspection, platformArtifacts: artifacts, artifact }
  await writeJson(join(output, 'manifest.json'), receipt)
  return receipt
}

async function packDirectory(directory, output) {
  const result = JSON.parse(npmCommand(['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
    cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  }))[0]
  const absolutePath = join(output, result.filename)
  const bytes = await readFile(absolutePath)
  return { name: result.name, version: result.version, filename: result.filename, absolutePath,
    size: result.size, unpackedSize: result.unpackedSize, entryCount: result.entryCount,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = {}
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = { '--output': 'output', '--stage': 'stage', '--name': 'name', '--windows-payload': 'windowsPayload' }[process.argv[index]]
    assert(key && process.argv[index + 1], 'Usage: npm-pack.mjs [--output DIR] [--stage DIR] [--name PACKAGE] [--windows-payload DIR]')
    options[key] = process.argv[index + 1]
  }
  process.stdout.write(`${JSON.stringify(await packNpm(options), null, 2)}\n`)
}
