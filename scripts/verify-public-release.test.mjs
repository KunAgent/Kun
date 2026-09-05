import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { stringify } from 'yaml'

const run = promisify(execFile)
const script = fileURLToPath(new URL('./verify-public-release.mjs', import.meta.url))
const version = '0.3.8'
const commit = 'a'.repeat(40)
const bytes = Buffer.from('verified-candidate')
const sha512 = createHash('sha512').update(bytes).digest('base64')
const manifests = {
  'latest.yml': ['Kun-0.3.8-win-x64.exe'],
  'latest-mac.yml': ['Kun-0.3.8-mac-arm64.zip', 'Kun-0.3.8-mac-x64.zip'],
  'latest-linux.yml': ['Kun-0.3.8-linux-x86_64.AppImage'],
  'latest-linux-arm64.yml': ['Kun-0.3.8-linux-arm64.AppImage']
}

async function fixture(options, action) {
  const root = await mkdtemp(join(tmpdir(), 'kun-public-release-'))
  const methods = []
  const server = createServer((request, response) => {
    methods.push(request.method)
    const name = new URL(request.url, 'http://localhost').pathname.split('/').at(-1)
    if (manifests[name]) {
      response.end(stringify({ version, files: manifests[name].map((url) => ({ url, size: bytes.length, sha512 })) }))
    } else if (name === 'latest.json') {
      response.end(JSON.stringify({ version }))
    } else if (name.startsWith('Kun-')) response.end(options.tamper ? 'tampered-bytes' : bytes)
    else { response.statusCode = 404; response.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    for (const target of ['win32-x64', 'darwin-arm64', 'darwin-x64']) {
      const [platform, arch] = target.split('-')
      const path = join(root, 'upgrade-evidence', `gui-upgrade-${target}`, `gui-upgrade-${target}.json`)
      await mkdir(dirname(path), { recursive: true })
      const scenarios = platform === 'win32' ? ['normal', 'busy', 'rollback', 'manual'] : ['normal']
      await writeFile(path, JSON.stringify({ version, commit: options.stale ? 'b'.repeat(40) : commit,
        platform, arch, sha512, status: options.skipped ? 'skipped' : 'passed',
        artifact: platform === 'win32' ? 'Kun-0.3.8-win-x64.exe' : `Kun-0.3.8-mac-${arch}.zip`,
        scenarios: scenarios.map((name) => ({ name, status: 'passed' })) }))
    }
    const execute = (mode) => run(process.execPath, [script, mode], { cwd: root, timeout: 20_000,
      env: { ...process.env, RELEASE_VERSION: version, TAG_NAME: `v${version}`, CANDIDATE_COMMIT: commit,
        R2_PUBLIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, R2_RELEASE_PREFIX: 'deepseek-gui' } })
    await action({ execute, root })
    assert.ok(methods.length > 0)
    assert.ok(methods.every((method) => method === 'GET'), 'Verification must never change public feeds')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}

test('public candidate verification hashes downloads and saves previous feeds without publishing', async () => {
  await fixture({}, async ({ execute, root }) => {
    await execute('candidate')
    const verified = JSON.parse(await readFile(join(root, 'public-release-evidence/candidate-verified.json'), 'utf8'))
    assert.equal(verified.verified.length, 5)
    assert.equal(verified.commit, commit)
    await readFile(join(root, 'public-release-evidence/previous-stable-latest.yml'))
    await readFile(join(root, 'public-release-evidence/previous-legacy-latest.yml'))
    await execute('latest')
  })
})

for (const [name, options] of [['altered artifact bytes', { tamper: true }],
  ['another commit', { stale: true }], ['skipped native acceptance', { skipped: true }]]) {
  test(`public candidate rejects ${name}`, async () => {
    await fixture(options, async ({ execute }) => {
      await assert.rejects(execute('candidate'))
    })
  })
}
