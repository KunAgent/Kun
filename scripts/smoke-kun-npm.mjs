#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir, release, version as osVersion } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { FIXTURE_REPLY, startFixtureModel } from './lib/kun-npm-smoke-model.mjs'
import { guardCompilers, locateNpm, removeSmokeFixture, runProcess, smokeEnvironment } from './lib/kun-npm-smoke-process.mjs'
import { exerciseInstalledServer } from './lib/kun-npm-smoke-server.mjs'
import { exerciseInstalledIntegrations } from './lib/kun-npm-smoke-integrations.mjs'
import { exerciseInstalledWindows } from './lib/kun-npm-smoke-windows.mjs'

export function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === '--keep-work') { options.keepWork = true; continue }
    if (key === '--integrations') { options.integrations = true; continue }
    if (!['--tarball', '--output', '--node', '--npm-cli', '--platform-tarball'].includes(key)) throw new Error(`Unknown argument: ${key}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    options[key.slice(2)] = resolve(value)
  }
  if (!options.tarball || !options.output) throw new Error('Usage: node scripts/smoke-kun-npm.mjs --tarball FILE --output RECEIPT [--node PATH] [--keep-work]')
  return options
}

export function tarEntries(archive) {
  const bytes = gunzipSync(archive)
  const entries = []
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const value = (start, size) => header.subarray(start, start + size).toString().replace(/\0.*$/su, '')
    const name = [value(345, 155), value(0, 100)].filter(Boolean).join('/')
    const size = parseInt(value(124, 12).trim() || '0', 8)
    assert(Number.isSafeInteger(size) && size >= 0, 'Invalid tar entry size')
    assert(!name.split('/').includes('..') && !name.startsWith('/'), 'Unsafe tar entry path')
    entries.push({ name, type: value(156, 1), content: bytes.subarray(offset + 512, offset + 512 + size) })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

async function installedPackage(prefix, name, global) {
  const root = join(prefix, ...(global && process.platform !== 'win32' ? ['lib'] : []), 'node_modules', ...name.split('/'))
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.kun
  assert(bin, 'Installed package must expose kun')
  return { root, manifest, entry: join(root, bin) }
}

async function assertContainedLinks(root) {
  const canonical = await realpath(root)
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await realpath(path)
        assert(target === canonical || target.startsWith(`${canonical}${sep}`), `Installed package links outside its own tree: ${path}`)
      } else if (entry.isDirectory()) pending.push(path)
    }
  }
}

function jsonOutput(output) {
  const line = output.trim().split('\n').findLast((line) => line.startsWith('{'))
  assert(line, `No JSON output: ${output.slice(-1000)}`)
  return JSON.parse(line)
}

export async function runSmoke(options) {
  const runId = randomUUID()
  try { return await runCoreSmoke({ ...options, runId }) } catch (error) {
    let recorded = false
    try { recorded = JSON.parse(await readFile(options.output, 'utf8')).runId === runId } catch { /* No receipt for this attempt. */ }
    if (options.output && !recorded) {
      await mkdir(dirname(options.output), { recursive: true })
      await writeFile(options.output, JSON.stringify({ schemaVersion: 1, runId, success: false, gateAComplete: false,
        platform: process.platform, arch: process.arch, nodeVersion: process.versions.node,
        checks: [{ id: 'artifact-preflight', status: 'fail', detail: String(error.stack ?? error) }] }, null, 2) + '\n')
    }
    throw error
  }
}

async function runCoreSmoke(options) {
  const node = options.node ?? process.execPath
  const version = (await runProcess(node, ['--version'])).stdout.trim().replace(/^v/u, '')
  assert(/^26\./u.test(version) && Number(version.split('.')[1]) >= 4, 'Smoke requires Node >=26.4 <27; use --node')
  const npm = locateNpm(node, options['npm-cli'])
  const archive = await readFile(options.tarball)
  const entries = tarEntries(archive)
  const manifestEntry = entries.find((entry) => entry.name === 'package/package.json')
  assert(manifestEntry, 'Tarball package.json is missing')
  const manifest = JSON.parse(manifestEntry.content.toString())
  const root = await mkdtemp(join(tmpdir(), 'kun npm smoke 中文 '))
  // Keep both installs on the exact bytes whose digest the receipt records,
  // even when a developer rebuilds the candidate path during this smoke.
  const candidate = join(root, 'candidate.tgz')
  await writeFile(candidate, archive)
  const receipt = {
    schemaVersion: 1, runId: options.runId, platform: process.platform, arch: process.arch, nodeVersion: version,
    os: { release: release(), version: osVersion(),
      glibc: process.platform === 'linux' ? process.report?.getReport()?.header?.glibcVersionRuntime ?? null : null },
    packageName: manifest.name, packageVersion: manifest.version,
    sourceCommit: manifest.kunNpm?.sourceCommit, sourceDirty: manifest.kunNpm?.sourceDirty,
    buildId: manifest.kunNpm?.buildId,
    tarballSha256: createHash('sha256').update(archive).digest('hex'), workDirectory: root,
    isolation: { sourceImports: false, homeChanged: false, unrestrictedHostFilesystem: true, compilerGuards: 'PATH' },
    checks: [], success: false, gateAComplete: false,
    limitations: ['Local harness does not sandbox host filesystem or certify absence of installed desktop applications.', 'Only the current OS/CPU/Node combination is exercised.']
  }
  const check = async (id, operation) => {
    const started = Date.now()
    process.stdout.write(`[npm-smoke] ${id}\n`)
    try {
      const detail = await operation()
      receipt.checks.push({ id, status: 'pass', durationMs: Date.now() - started, ...(detail ? { detail } : {}) })
    } catch (error) {
      receipt.checks.push({ id, status: 'fail', durationMs: Date.now() - started, detail: String(error.stack ?? error) })
      throw error
    }
  }
  let model
  try {
    const env = smokeEnvironment(node, root)
    env.KUN_NPM_COMPILER_AUDIT = await guardCompilers(root)
    receipt.npmVersion = (await runProcess(node, [npm, '--version'], { env })).stdout.trim()
    const globalPrefix = join(root, 'global prefix')
    const npmInstall = async (prefix, global) => {
      await mkdir(prefix, { recursive: true })
      const command = ['install', ...(global ? ['--global', '--prefix', prefix] : []), '--cache', join(root, global ? 'global-cache' : 'project-cache'),
        '--offline', '--omit=dev', '--engine-strict', '--no-audit', '--no-fund', '--registry', 'https://registry.npmjs.org',
        ...(options['platform-tarball'] ? [options['platform-tarball']] : []), candidate]
      const result = await runProcess(node, [npm, ...command], { cwd: prefix, env, timeout: 600_000 })
      assert(!existsSync(env.KUN_NPM_COMPILER_AUDIT), 'A native compiler was invoked during installation')
      await writeFile(join(root, global ? 'global-install.log' : 'project-install.log'), result.stdout + result.stderr)
      return installedPackage(prefix, manifest.name, global)
    }
    let installed
    await check('NPM-01.project-install', async () => {
      const project = join(root, 'ordinary project')
      await mkdir(project, { recursive: true })
      await writeFile(join(project, 'package.json'), '{"name":"kun-npm-consumer","private":true}')
      const local = await npmInstall(project, false)
      await assertContainedLinks(local.root)
      const result = await runProcess(node, [npm, 'exec', '--offline', '--', 'kun', '--version'], { cwd: project, env })
      assert(result.stdout.includes(manifest.version))
      await rm(project, { recursive: true, force: true })
      await rm(join(root, 'project-cache'), { recursive: true, force: true })
    })
    await check('NPM-01.global-install', async () => {
      installed = await npmInstall(globalPrefix, true)
      assert.equal(installed.manifest.version, manifest.version)
      await assertContainedLinks(installed.root)
    })
    await check('NPM-02.payload', async () => {
      assert.equal(manifest.kunNpm?.kind, 'npm')
      assert(entries.some((entry) => entry.name === 'package/npm-shrinkwrap.json'))
      assert(entries.some((entry) => /^package\/LICENSE(?:\.|$)/u.test(entry.name)))
      const forbidden = entries.filter((entry) => /^package\/(?:src|tests|benchmarks|\.cache)\//u.test(entry.name) ||
        /^package\/dist\/.*(?:\.test\.|test-support|\.d\.ts|\.map$)/u.test(entry.name))
      assert.deepEqual(forbidden.map((entry) => entry.name), [])
    })
    await check('NPM-03.locked-bundle', async () => {
      const lock = JSON.parse(await readFile(join(installed.root, 'npm-shrinkwrap.json'), 'utf8'))
      let verified = 0
      for (const [key, entry] of Object.entries(lock.packages)) {
        if (!key || !entry.inBundle) continue
        const path = join(installed.root, key, 'package.json')
        if (!existsSync(path) && entry.optional &&
          ((entry.os && !entry.os.includes(process.platform)) || (entry.cpu && !entry.cpu.includes(process.arch)))) continue
        const actual = JSON.parse(await readFile(path, 'utf8'))
        assert.equal(actual.version, entry.version, `Installed dependency drift: ${key}`)
        assert(!actual.scripts?.install && !actual.scripts?.postinstall, `Unbuilt dependency: ${key}`)
        verified++
      }
      return { verifiedDependencyVersions: verified }
    })
    const invoke = (args, extra = {}) => runProcess(node, [installed.entry, ...args], { cwd: root, env, timeout: 90_000, ...extra })
    await check('NPM-05.help-version-update', async () => {
      assert.match((await invoke(['--help'])).stdout, /kun.*command/u)
      assert((await invoke(['--version'])).stdout.includes(manifest.version))
      const update = await invoke(['update', '--check'])
      assert.match(update.stdout + update.stderr, /npm/iu)
      assert(!existsSync(env.KUN_DATA_DIR), 'Help/version/update created a data directory')
      if (process.platform !== 'win32') {
        const shim = join(globalPrefix, 'bin', 'kun')
        assert((await runProcess(shim, ['--version'], { cwd: root, env })).stdout.includes(manifest.version))
      } else {
        const shim = join(globalPrefix, 'kun.cmd')
        const command = process.env.ComSpec ?? join(process.env.SystemRoot, 'System32/cmd.exe')
        const result = await runProcess(command, ['/d', '/s', '/c', `""${shim}" --version"`],
          { cwd: root, env, windowsVerbatimArguments: true })
        assert(result.stdout.includes(manifest.version), 'Installed global Windows shim did not run')
      }
    })
    model = await startFixtureModel()
    const workspace = join(root, 'workspace space 中文')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'input.txt'), 'installed-file-read-ok')
    const config = join(root, 'config.json')
    const configValue = {
      serve: { host: '127.0.0.1', port: 0, dataDir: env.KUN_DATA_DIR, runtimeToken: env.KUN_RUNTIME_TOKEN,
        apiKey: env.DEEPSEEK_API_KEY, baseUrl: `${model.url}/v1`, model: 'kun-npm-fixture', endpointFormat: 'chat_completions',
        approvalPolicy: 'auto', sandboxMode: 'workspace-write', tokenEconomyMode: false, storage: { backend: 'hybrid' } }
    }
    await writeFile(config, JSON.stringify(configValue))
    if (process.platform === 'win32') await exerciseInstalledWindows({ node, installed, root, env, config, check })
    const common = ['--config', config, '--data-dir', env.KUN_DATA_DIR, '--workspace', workspace]
    await check('NPM-04.sqlite-native', async () => {
      const script = `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(join(installed.root, 'package.json'))});const D=r('better-sqlite3');const db=new D(':memory:');db.exec('create table smoke(value text)');db.prepare('insert into smoke values (?)').run('native');if(db.prepare('select value from smoke').get().value!=='native')throw Error('sqlite query');db.close();`
      await runProcess(node, ['--eval', script], { cwd: root, env })
    })
    await check('RUN-01.run-jsonl', async () => {
      const result = await invoke(['run', ...common, '--jsonl', 'Return the fixture marker'])
      const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line))
      assert(lines.some((line) => line.type === 'run_started'))
      assert(lines.some((line) => line.type === 'run_finished' && line.status === 'completed'))
      assert(result.stdout.includes(FIXTURE_REPLY))
      assert(model.requests.some((request) => request.path === '/v1/chat/completions'))
    })
    await check('NPM-04.runtime-index', async () => {
      const script = `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(join(installed.root, 'package.json'))});const D=r('better-sqlite3');const db=new D(${JSON.stringify(join(env.KUN_DATA_DIR, 'index.sqlite3'))},{readonly:true,fileMustExist:true});const {total}=db.prepare('SELECT COUNT(*) AS total FROM threads').get();db.close();if(!(total>0))throw Error('Runtime SQLite index has no records');console.log(JSON.stringify({indexedThreads:total}));`
      const result = await runProcess(node, ['--eval', script], { cwd: root, env })
      return JSON.parse(result.stdout)
    })
    await check('RUN-01.stdin-chat', async () => {
      assert((await invoke(['run', ...common, '--prompt-file', '-'], { input: 'Return fixture marker from stdin' })).stdout.includes(FIXTURE_REPLY))
      assert((await invoke(['chat', ...common], { input: 'Return fixture marker in chat\n/exit\n' })).stdout.includes(FIXTURE_REPLY))
    })
    await check('NPM-05.exec-file', async () => {
      const list = jsonOutput((await invoke(['exec', ...common, '--list-tools', '--json'])).stdout)
      assert(list.tools.some((tool) => tool.name === 'read'))
      const result = await invoke(['exec', ...common, 'read', '--args', JSON.stringify({ path: 'input.txt' }), '--json'])
      assert(result.stdout.includes('installed-file-read-ok'))
    })
    await check('RUN-07.file-shell', async () => {
      await invoke(['exec', ...common, 'write', '--args', JSON.stringify({ path: 'created.txt', content: 'artifact-write-ok' }), '--json'])
      assert.equal(await readFile(join(workspace, 'created.txt'), 'utf8'), 'artifact-write-ok')
      const shell = await invoke(['exec', ...common, 'bash', '--args', JSON.stringify({ command: 'node -e "console.log(12345)"' }), '--json'])
      assert(shell.stdout.includes('12345'))
    })
    await check('RUN-08.denied-policy', async () => {
      const denied = await invoke(['exec', ...common, '--approval-policy', 'never', 'read',
        '--args', JSON.stringify({ path: 'input.txt' }), '--json'], { allowFailure: true, timeout: 30_000 })
      assert.notEqual(denied.code, 0)
      assert(denied.stdout.includes('approval_policy_blocked'))
    })
    await check('RUN-08.noninteractive-channel', async () => {
      for (const marker of ['INPUT', 'APPROVAL_deny']) {
        const blocked = await invoke(['run', ...common, '--approval-policy', 'always',
          `KUN_ARTIFACT_VERIFY_${marker}: Require the fixture interaction before continuing.`],
        { allowFailure: true, timeout: 30_000 })
        assert.notEqual(blocked.code, 0, 'A missing interactive channel must not look successful')
        assert(blocked.stderr.includes('interactive approval or input is unavailable'), blocked.stderr)
      }
      assert(!existsSync(join(workspace, 'approval-deny.txt')))
    })
    await check('RUN-03.endpoint-families', async () => {
      for (const endpointFormat of ['messages', 'responses']) {
        const alternate = join(root, `${endpointFormat}.json`)
        // A provider connection is persisted once admitted. Each independent
        // endpoint configuration therefore needs its own complete profile.
        const profile = join(root, `provider-${endpointFormat}`)
        await mkdir(profile, { recursive: true })
        const providerEnv = smokeEnvironment(node, profile)
        await writeFile(alternate, JSON.stringify({ serve: { ...configValue.serve,
          dataDir: providerEnv.KUN_DATA_DIR, endpointFormat } }))
        const result = await invoke(['run', ...common, '--config', alternate, '--data-dir', providerEnv.KUN_DATA_DIR,
          'Return fixture marker'], { env: providerEnv })
        assert(result.stdout.includes(FIXTURE_REPLY), `${endpointFormat}: ${result.stdout}`)
      }
      assert(model.requests.some((request) => request.path === '/v1/messages'))
      assert(model.requests.some((request) => request.path === '/v1/responses'))
    })
    await exerciseInstalledServer({ node, installed, root, env, config, workspace, check })
    if (options.integrations) await exerciseInstalledIntegrations({ node, installed, root, env,
      configValue, workspace, check })
    await check('DATA-02.uninstall-preserves-history', async () => {
      const pending = [env.KUN_DATA_DIR]
      const before = new Map()
      while (pending.length) {
        const directory = pending.pop()
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = join(directory, entry.name)
          if (entry.isDirectory()) pending.push(file)
          else if (entry.isFile()) before.set(file, createHash('sha256').update(await readFile(file)).digest('hex'))
        }
      }
      assert(before.size > 0)
      await runProcess(node, [npm, 'uninstall', '--global', '--prefix', globalPrefix, '--offline',
        '--cache', join(root, 'global-cache'), '--no-audit', '--no-fund', manifest.name], { cwd: root, env, timeout: 90_000 })
      assert(!existsSync(installed.entry))
      for (const [file, hash] of before) {
        assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, `Uninstall changed user data: ${file}`)
      }
      return { verifiedDataFiles: before.size }
    })
    if (options.integrations) receipt.checks.push({ id: 'RUN-07', status: 'pass',
      detail: 'Installed file/shell, goal/task/plan, Skill, stdio MCP, image attachment and native subagent were exercised.' },
    { id: 'RUN-08', status: 'pass', detail: 'Allowed/denied API approvals, structured answers and bounded noninteractive rejection were exercised.' })
    for (const id of [...(!options.integrations ? ['RUN-07', 'RUN-08'] : []),
      'DATA-02', 'GUI-01', 'REG-01', 'REG-02', 'REG-03', 'REG-04']) {
      receipt.checks.push({ id, status: 'not-run', detail: 'Outside this local core artifact smoke; requires the corresponding acceptance suite or release stage.' })
    }
    receipt.success = true
  } catch (error) {
    receipt.error = String(error.stack ?? error)
  } finally {
    try {
      await model?.close()
      if (!options.keepWork) await removeSmokeFixture(root)
    } catch (error) {
      receipt.success = false
      receipt.checks.push({ id: 'fixture.cleanup', status: 'fail', detail: String(error.stack ?? error) })
      receipt.error = [receipt.error, String(error.stack ?? error)].filter(Boolean).join('\n')
    }
    await mkdir(dirname(options.output), { recursive: true })
    await writeFile(options.output, JSON.stringify(receipt, null, 2) + '\n')
  }
  if (!receipt.success) throw new Error(`npm artifact smoke failed; receipt: ${options.output}\n${receipt.error}`)
  return receipt
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runSmoke(parseArguments(process.argv.slice(2))).then((receipt) => {
    process.stdout.write(`npm core artifact smoke passed: ${receipt.packageName}@${receipt.packageVersion} (${receipt.platform}-${receipt.arch}, Node ${receipt.nodeVersion})\n`)
  }).catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1 })
}
