import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { parseArguments, runSmoke, tarEntries } from './smoke-kun-npm.mjs'
import { FIXTURE_REPLY, startFixtureModel } from './lib/kun-npm-smoke-model.mjs'
import { removeSmokeFixture, runProcess, smokeEnvironment } from './lib/kun-npm-smoke-process.mjs'

test('artifact smoke requires concrete archive and receipt and rejects unknown options', () => {
  assert.throws(() => parseArguments(['--tarball', 'a.tgz']), /Usage/)
  assert.throws(() => parseArguments(['--publish']), /Unknown/)
  assert.throws(() => parseArguments(['--tarball', '--output']), /Missing/)
  const options = parseArguments(['--tarball', 'a.tgz', '--output', 'b.json', '--keep-work'])
  assert.equal(basename(options.tarball), 'a.tgz')
  assert.equal(options.keepWork, true)
})

function archive(name, content) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100)
  header.write(Buffer.byteLength(content).toString(8).padStart(11, '0'), 124, 12)
  header.write('0', 156)
  const value = Buffer.alloc(Math.ceil(Buffer.byteLength(content) / 512) * 512)
  value.write(content)
  return gzipSync(Buffer.concat([header, value, Buffer.alloc(1024)]))
}

test('tarball inspection reads artifact metadata and rejects package traversal', () => {
  const entries = tarEntries(archive('package/package.json', '{"name":"fixture"}'))
  assert.equal(JSON.parse(entries[0].content).name, 'fixture')
  assert.throws(() => tarEntries(archive('package/../../escape', 'x')), /Unsafe/)
})

test('fixture server speaks all three configured model protocols with streaming usage', async () => {
  const model = await startFixtureModel()
  try {
    for (const endpoint of ['chat/completions', 'messages', 'responses']) {
      const response = await fetch(`${model.url}/v1/${endpoint}`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'fixture', stream: true }) })
      assert.equal(response.status, 200)
      const text = await response.text()
      assert(text.includes(FIXTURE_REPLY))
      assert(text.includes('usage'))
    }
    assert.equal(model.requests.length, 3)
  } finally { await model.close() }
})

test('driver preserves failure and timeout evidence without hanging', async () => {
  const failure = await runProcess(process.execPath, ['--eval', 'process.exit(7)'], { allowFailure: true })
  assert.equal(failure.code, 7)
  const timeout = await runProcess(process.execPath, ['--eval', 'setInterval(()=>{},1000)'], { allowFailure: true, timeout: 30 })
  assert.equal(timeout.timedOut, true)
})

test('fixture environment isolates Kun paths and removes inherited provider controls', () => {
  const root = join(tmpdir(), 'kun-smoke-test')
  const env = smokeEnvironment(process.execPath, root)
  assert.equal(env.KUN_DATA_DIR, join(root, 'data'))
  assert.equal(env.KUN_MANAGER_SETTINGS_PATH, join(root, 'settings.json'))
  assert.equal(env.NODE_PATH, undefined)
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.HOME, process.env.HOME)
})

test('Windows Path casing is preserved when building the isolated compiler-guard environment', () => {
  const env = smokeEnvironment(process.execPath, join(tmpdir(), 'kun-path-case'), { Path: 'C:\\tools\\python;C:\\Windows\\System32' })
  assert(env.PATH.includes('C:\\tools\\python'))
  assert.equal(env.Path, undefined)
})

test('preflight failure replaces a stale passing receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-smoke-receipt-'))
  const output = join(root, 'receipt.json')
  try {
    await writeFile(output, '{"success":true,"runId":"previous"}')
    await assert.rejects(runSmoke({ tarball: join(root, 'absent.tgz'), output }))
    const receipt = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(receipt.success, false)
    assert.equal(receipt.checks[0].id, 'artifact-preflight')
    assert.notEqual(receipt.runId, 'previous')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('fixture cleanup removes immutable extensions without changing symlink targets', {
  skip: process.platform === 'win32' && 'POSIX permission and symlink fixture'
}, async () => {
  const parent = await mkdtemp(join(tmpdir(), 'kun-smoke-cleanup-'))
  const root = join(parent, 'fixture')
  const extension = join(root, 'immutable-extension')
  const outside = join(parent, 'external-data.txt')
  try {
    await mkdir(extension, { recursive: true })
    await writeFile(join(extension, 'manifest.json'), '{}', { mode: 0o400 })
    await writeFile(outside, 'preserved', { mode: 0o400 })
    await symlink(outside, join(root, 'link'))
    await chmod(extension, 0o500)
    await removeSmokeFixture(root)
    await assert.rejects(stat(root), { code: 'ENOENT' })
    assert.equal(await readFile(outside, 'utf8'), 'preserved')
    assert.equal((await stat(outside)).mode & 0o777, 0o400)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
