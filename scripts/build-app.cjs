'use strict'

const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { existsSync, lstatSync, statSync, readdirSync, readFileSync, readlinkSync, mkdirSync, rmSync, renameSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const outputs = ['out', 'kun/dist', 'resources/bundled-extensions',
  ...(process.platform === 'darwin' ? ['resources/native/remote-desktop-input', 'resources/native/pet-activity'] : []),
  ...['provider-catalog', 'extension-api', 'extension-react', 'extension-test']
    .map(name => `packages/${name}/dist`)]

function hashPaths(root, paths) {
  const hash = createHash('sha256')
  function visit(path) {
    const absolute = join(root, path)
    hash.update(`${path}\0`)
    if (!existsSync(absolute)) { hash.update('missing\0'); return }
    const stat = lstatSync(absolute)
    hash.update(`mode:${stat.mode}\0`)
    if (stat.isSymbolicLink()) {
      hash.update(`link:${readlinkSync(absolute)}\0`)
      const target = statSync(absolute)
      if (target.isFile()) {
        hash.update(`${target.mode}:${target.size}:`)
        hash.update(readFileSync(absolute))
        hash.update('\0')
      }
    } else if (stat.isDirectory()) {
      hash.update('directory\0')
      for (const entry of readdirSync(absolute).sort()) visit(join(path, entry))
    } else {
      hash.update(`${stat.size}:`)
      hash.update(readFileSync(absolute))
      hash.update('\0')
    }
  }
  for (const path of [...paths].sort()) visit(path)
  return hash.digest('hex')
}

function inputFingerprint(root, env = process.env) {
  // Include untracked authored inputs and path names so additions, deletions and
  // branch switches invalidate the build, even when mtimes are preserved.
  const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  })
  if (files.status !== 0) return null // Source archives still build, without reuse.
  const dotenvPaths = []
  // Vite loads ignored dotenv files inside child processes, after this parent
  // environment is captured. Include their names and bytes so additions,
  // changes and removals at every current Vite envDir invalidate reuse.
  for (const directory of ['.', 'kun', 'src/canvas-app']) {
    const absolute = join(root, directory)
    if (!existsSync(absolute)) continue
    for (const name of readdirSync(absolute).filter(name => /^\.env(?:\.|$)/.test(name))) {
      dotenvPaths.push(directory === '.' ? name : `${directory}/${name}`)
    }
  }
  const paths = [...new Set([...files.stdout.split('\0').filter(Boolean), ...dotenvPaths]),
    'node_modules/.package-lock.json', 'kun/node_modules/.package-lock.json']
  const buildEnv = Object.fromEntries(Object.entries(env)
    .filter(([key]) => !/^(?:npm_|PWD$|OLDPWD$|SHLVL$|_$|INIT_CWD$|KUN_FORCE_BUILD$)/.test(key))
    .sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(JSON.stringify({
    version: 1, node: process.version, platform: process.platform, arch: process.arch,
    env: buildEnv, inputs: hashPaths(root, paths)
  })).digest('hex')
}

function outputFingerprint(root) {
  if (!outputs.every(path => existsSync(join(root, path)))) return null
  // Hash the complete output trees, not just index.html: missing, tampered or
  // partially emitted chunks must force a rebuild rather than ship stale code.
  return hashPaths(root, outputs)
}

function buildApp(root, env = process.env, launch) {
  const stamp = join(root, '.cache', 'app-build.json')
  const input = inputFingerprint(root, env)
  let previous
  try { previous = JSON.parse(readFileSync(stamp, 'utf8')) } catch { previous = null }
  if (env.KUN_FORCE_BUILD !== '1' && input && previous?.input === input &&
      previous.output && previous.output === outputFingerprint(root)) {
    console.log('[build] inputs and complete outputs unchanged; reusing verified build')
    return 0
  }
  rmSync(stamp, { force: true })
  // tsc does not remove emits for deleted sources. Clear only our generated
  // workspace dist trees before a cold build so obsolete modules cannot ship.
  for (const path of outputs.filter(path => path.startsWith('packages/'))) {
    rmSync(join(root, path), { recursive: true, force: true })
  }
  const run = launch || (() => {
    const npm = env.npm_execpath || (process.platform === 'win32'
      ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
      : join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'))
    return spawnSync(process.execPath, [resolve(npm), 'run', 'build:app'], {
      cwd: root, env, stdio: 'inherit'
    }).status ?? 1
  })
  const status = run()
  if (status !== 0) return status
  const output = outputFingerprint(root)
  if (input && output && input === inputFingerprint(root, env)) {
    mkdirSync(join(root, '.cache'), { recursive: true })
    const temporary = `${stamp}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ input, output }) + '\n')
    renameSync(temporary, stamp)
  }
  return 0
}

module.exports = { buildApp, hashPaths, inputFingerprint, outputFingerprint, outputs }
if (require.main === module) process.exit(buildApp(process.cwd()))
