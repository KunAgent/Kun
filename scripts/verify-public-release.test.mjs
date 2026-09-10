import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const sha256 = createHash('sha256').update(bytes).digest('hex')
const manifests = {
  'latest.yml': ['Kun-0.3.8-win-x64.exe'],
  'latest-mac.yml': ['Kun-0.3.8-mac-arm64.zip', 'Kun-0.3.8-mac-x64.zip', 'Kun-0.3.8-mac-arm64.dmg', 'Kun-0.3.8-mac-x64.dmg'],
  'latest-linux.yml': ['Kun-0.3.8-linux-x86_64.AppImage', 'Kun-0.3.8-linux-amd64.deb'],
  'latest-linux-arm64.yml': ['Kun-0.3.8-linux-arm64.AppImage', 'Kun-0.3.8-linux-arm64.deb']
}

async function fixture(options, action) {
  const root = await mkdtemp(join(tmpdir(), 'kun-public-release-'))
  const methods = []
  const requests = new Map()
  const server = createServer((request, response) => {
    methods.push(request.method)
    const name = new URL(request.url, 'http://localhost').pathname.split('/').at(-1)
    const count = (requests.get(request.url) || 0) + 1
    requests.set(request.url, count)
    if (options.interrupted && name.endsWith('.exe') && count === 1) {
      response.writeHead(200, { 'Content-Length': bytes.length })
      response.write(bytes.subarray(0, 4))
      setTimeout(() => response.destroy(), 20)
      return
    }
    if (options.unavailable && name === 'latest.yml' && count === 1) {
      response.writeHead(503)
      response.end('Temporarily unavailable')
      return
    }
    if (manifests[name]) {
      const files = manifests[name].filter(url => url !== options.missingArtifact).map(url => ({
        url: options.outsideFeed ? `https://example.com/${url}` : url + (options.revision ? `?revision=${commit}` : ''),
        size: bytes.length, sha512
      }))
      response.end(stringify({ version: options.wrongVersion ? '0.3.7' : version, files }))
    } else if (name === 'latest.json') {
      const stale = options.staleStableJson && request.url.includes('/channels/stable/latest/')
      response.end(JSON.stringify({ version: stale ? '0.3.7' : version }))
    } else if (name.startsWith('Kun-')) response.end(options.tamper ? 'tampered-bytes' : bytes)
    else { response.statusCode = 404; response.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await writeFile(join(root, 'candidate-release.json'), JSON.stringify({
      tagName: options.wrongTag ? 'v0.3.7' : `v${version}`, isDraft: !options.published,
      assets: Object.values(manifests).flat().filter(name => name !== options.missingGithubAsset).map(name => ({
        name, state: 'uploaded', size: bytes.length,
        digest: `sha256:${options.wrongGithubDigest ? '0'.repeat(64) : sha256}`
      }))
    }))
    const execute = (mode) => run(process.execPath, [script, mode], { cwd: root, timeout: 20_000,
      env: { ...process.env, RELEASE_VERSION: version, TAG_NAME: `v${version}`, CANDIDATE_COMMIT: commit,
        R2_PUBLIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, R2_RELEASE_PREFIX: 'deepseek-gui' } })
    await action({ execute, root, requests })
    if (options.wrongTag || options.published) assert.equal(methods.length, 0)
    else assert.ok(methods.length > 0)
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
    assert.equal(verified.verified.length, 9)
    assert.equal(verified.commit, commit)
    assert.equal(verified.verification, 'artifact-integrity')
    assert.ok(verified.verified.every(file => file.sha256 === sha256))
    await readFile(join(root, 'public-release-evidence/previous-stable-latest.yml'))
    await readFile(join(root, 'public-release-evidence/previous-legacy-latest.yml'))
    await execute('latest')
  })
})

for (const [name, options] of [
  ['interrupted artifact bodies', { interrupted: true }],
  ['temporarily unavailable manifests', { unavailable: true }]
]) {
  test(`public verification recovers from ${name} and verifies complete bytes`, async () => {
    await fixture(options, async ({ execute, root, requests }) => {
      for (const mode of ['candidate', 'latest']) {
        await execute(mode)
        const receipt = JSON.parse(await readFile(join(root, `public-release-evidence/${mode}-verified.json`), 'utf8'))
        assert.equal(receipt.verified.length, mode === 'candidate' ? 9 : 18)
        assert.ok(receipt.verified.every(file => file.sha256 === sha256 && file.sha512 === sha512 && file.size === bytes.length))
      }
      assert.ok([...requests.values()].some(count => count >= 2))
    })
  })
}

test('latest verification rejects a stale stable JSON feed even when legacy is current', async () => {
  await fixture({ staleStableJson: true }, async ({ execute }) => {
    await assert.rejects(execute('latest'))
  })
})

test('public verification accepts versioned download queries that avoid stale candidate caches', async () => {
  await fixture({ revision: true }, async ({ execute, root }) => {
    await execute('candidate')
    const receipt = JSON.parse(await readFile(join(root, 'public-release-evidence/candidate-verified.json'), 'utf8'))
    assert.ok(receipt.verified.every(file => new URL(file.url).searchParams.get('revision') === commit))
    await execute('latest')
  })
})

for (const [name, options] of [['altered artifact bytes', { tamper: true }],
  ['another version', { wrongVersion: true }], ['another GitHub tag', { wrongTag: true }],
  ['an already published candidate', { published: true }],
  ['missing installers', { missingArtifact: 'Kun-0.3.8-linux-arm64.deb' }],
  ['artifacts outside the release feed', { outsideFeed: true }],
  ['missing GitHub assets', { missingGithubAsset: 'Kun-0.3.8-mac-x64.zip' }],
  ['GitHub and R2 digest disagreement', { wrongGithubDigest: true }]]) {
  test(`public candidate rejects ${name}`, async () => {
    await fixture(options, async ({ execute }) => {
      await assert.rejects(execute('candidate'))
    })
  })
}
