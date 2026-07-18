import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertExecutableApiConformance,
  assertPathOutsideSourceTree,
  assertPublishableManifest,
  expectedApiMajors,
  npmInvocation,
  runRequiredCommand
} from './lib/extension-release-execution.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireKun = createRequire(join(root, 'kun', 'package.json'))

test('clean postinstall delegates to the canonical Extension API then Kun bootstrap', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const buildKun = manifest.scripts?.['build:kun'] ?? ''
  let priorIndex = -1
  for (const command of [
    'npm run build --workspace @kun/extension-api',
    'node ./scripts/ensure-kun-install.cjs',
    'npm --prefix kun run build'
  ]) {
    const index = buildKun.indexOf(command, priorIndex + 1)
    assert.notEqual(index, -1, `build:kun bootstrap is missing or reordered: ${command}`)
    priorIndex = index
  }

  const postinstall = await readFile(join(root, 'scripts', 'postinstall.cjs'), 'utf8')
  const canonicalBuild = "run('npm', ['run', 'build:kun'])"
  assert.ok(postinstall.includes(canonicalBuild), 'postinstall must delegate to build:kun')
  assert.doesNotMatch(postinstall, /require\(['"]\.\/ensure-kun-install\.cjs['"]\)/)
  assert.ok(
    postinstall.indexOf(canonicalBuild) < postinstall.indexOf("require('electron/package.json')"),
    'clean bootstrap must finish before native dependency rebuilds'
  )

  const kunLock = JSON.parse(await readFile(join(root, 'kun', 'package-lock.json'), 'utf8'))
  const semver = requireKun('semver')
  const wasmRuntime = kunLock.packages?.['node_modules/@napi-rs/wasm-runtime']
  for (const dependency of ['@emnapi/core', '@emnapi/runtime']) {
    const version = kunLock.packages?.[`node_modules/${dependency}`]?.version
    const peerRange = wasmRuntime?.peerDependencies?.[dependency]
    assert.ok(semver.valid(version), `Kun lock must contain top-level ${dependency} with a valid SemVer`)
    assert.equal(typeof peerRange, 'string', `@napi-rs/wasm-runtime must declare ${dependency} peer range`)
    assert.ok(
      semver.satisfies(version, peerRange),
      `Kun lock ${dependency}@${version} must satisfy @napi-rs/wasm-runtime ${peerRange}`
    )
  }
})

test('v1 uses the documented no-previous-major exception', () => {
  assert.deepEqual(expectedApiMajors('1.8.0'), [1])
  assert.doesNotThrow(() => assertExecutableApiConformance({
    currentVersion: '1.8.0',
    supportedVersions: ['1.8.0'],
    executedMajors: [1]
  }))
})

test('a future major fails closed without executable previous-major adaptation', () => {
  assert.deepEqual(expectedApiMajors('2.0.0'), [2, 1])
  assert.throws(
    () => assertExecutableApiConformance({
      currentVersion: '2.0.0',
      supportedVersions: ['2.0.0', '1.9.0'],
      executedMajors: [2]
    }),
    /missing for major\(s\): 1/
  )
  assert.doesNotThrow(() => assertExecutableApiConformance({
    currentVersion: '2.0.0',
    supportedVersions: ['2.0.0', '1.9.0'],
    executedMajors: [2, 1]
  }))
})

test('release commands propagate a non-zero child exit', () => {
  assert.throws(
    () => runRequiredCommand({
      label: 'intentional failure',
      command: process.execPath,
      args: ['-e', 'process.exit(9)'],
      capture: true
    }),
    /exit code 9/
  )
})

test('windows npm invocation avoids spawning npm.cmd when npm cli is discoverable', async () => {
  const install = await mkdtemp(join(tmpdir(), 'kun-node-install-'))
  try {
    const node = join(install, 'node.exe')
    const npmCli = join(install, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    await mkdir(dirname(npmCli), { recursive: true })
    await writeFile(npmCli, '')
    assert.deepEqual(
      npmInvocation({
        args: ['--version'],
        env: {},
        execPath: node,
        platform: 'win32'
      }),
      {
        command: node,
        args: [npmCli, '--version']
      }
    )
  } finally {
    await rm(install, { recursive: true, force: true })
  }
})

test('npm invocation prefers the active npm cli from the environment', () => {
  assert.deepEqual(
    npmInvocation({
      args: ['run', 'build'],
      env: { npm_execpath: '/tmp/npm-cli.js' },
      execPath: '/tmp/node',
      platform: 'win32'
    }),
    {
      command: '/tmp/node',
      args: ['/tmp/npm-cli.js', 'run', 'build']
    }
  )
})

test('publishable artifacts reject repository-local dependency aliases', () => {
  assert.throws(
    () => assertPublishableManifest({
      name: 'kun',
      dependencies: { '@kun/extension-api': 'file:../packages/extension-api' }
    }),
    /must use a publishable version/
  )
  assert.doesNotThrow(() => assertPublishableManifest({
    name: 'kun',
    dependencies: { '@kun/extension-api': '1.0.0' }
  }))
})

test('external acceptance projects cannot run inside the repository tree', async () => {
  const source = await mkdtemp(join(tmpdir(), 'kun-release-source-'))
  const external = await mkdtemp(join(tmpdir(), 'kun-release-external-'))
  try {
    assert.throws(() => assertPathOutsideSourceTree(source, join(source, 'fixture')), /outside/)
    assert.throws(() => assertPathOutsideSourceTree(source, join(source, '..fixture')), /outside/)
    assert.doesNotThrow(() => assertPathOutsideSourceTree(source, external))
  } finally {
    await Promise.all([
      rm(source, { recursive: true, force: true }),
      rm(external, { recursive: true, force: true })
    ])
  }
})
