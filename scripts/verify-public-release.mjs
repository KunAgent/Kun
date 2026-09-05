import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'

const mode = process.argv[2]
if (!['candidate', 'latest'].includes(mode)) throw new Error('Expected candidate or latest')
const version = process.env.RELEASE_VERSION
const tag = process.env.TAG_NAME
assert.match(version ?? '', /^\d+\.\d+\.\d+$/)
assert.equal(tag, `v${version}`)
const root = `${(process.env.R2_PUBLIC_BASE_URL || 'https://www.kun-agent.com/api/r2').replace(/\/+$/, '')}/${process.env.R2_RELEASE_PREFIX || 'deepseek-gui'}/`
const stable = `${root}channels/stable/`
const base = mode === 'candidate' ? `${stable}releases/${tag}/` : `${stable}latest/`
const evidence = 'public-release-evidence'
await mkdir(evidence, { recursive: true })
const manifests = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']
const downloads = new Map()

async function response(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000), cache: 'no-store' })
  if (!result.ok) throw new Error(`${url} returned HTTP ${result.status}`)
  return result
}

for (const feedBase of mode === 'candidate' ? [base] : [base, `${root}latest/`]) {
for (const manifest of manifests) {
  const text = await (await response(`${feedBase}${manifest}`)).text()
  const metadata = parse(text)
  assert.equal(metadata.version, version, manifest)
  assert.ok(Array.isArray(metadata.files) && metadata.files.length, manifest)
  for (const file of metadata.files) {
    const url = new URL(file.url, feedBase)
    assert.ok(url.href.startsWith(feedBase), `${manifest}: artifact is outside this release feed`)
    assert.ok(url.pathname.includes(`Kun-${version}-`), `${manifest}: incorrect artifact version`)
    assert.ok(file.size > 0 && typeof file.sha512 === 'string', `${manifest}: incomplete artifact metadata`)
    downloads.set(url.href, file)
  }
  const names = metadata.files.map((file) => file.url)
  const expected = {
    'latest.yml': [`Kun-${version}-win-x64.exe`],
    'latest-mac.yml': [`Kun-${version}-mac-arm64.zip`, `Kun-${version}-mac-x64.zip`],
    'latest-linux.yml': [`Kun-${version}-linux-x86_64.AppImage`],
    'latest-linux-arm64.yml': [`Kun-${version}-linux-arm64.AppImage`]
  }[manifest]
  for (const name of expected) assert.ok(names.some((value) => value.endsWith(name)), `${manifest}: missing ${name}`)
  await writeFile(join(evidence, `${mode}-${feedBase === base ? '' : 'legacy-'}${manifest}`), text)
}
}

if (mode === 'candidate') {
  for (const target of ['win32-x64', 'darwin-arm64', 'darwin-x64']) {
    const report = JSON.parse(await readFile(join('upgrade-evidence', `gui-upgrade-${target}`, `gui-upgrade-${target}.json`), 'utf8'))
    assert.equal(report.status, 'passed', target)
    assert.equal(report.version, version, target)
    assert.equal(report.commit, process.env.CANDIDATE_COMMIT, `${target}: evidence for another commit`)
    assert.equal(`${report.platform}-${report.arch}`, target)
    const expectedScenarios = target.startsWith('win32') ? ['normal', 'busy', 'rollback', 'manual'] : ['normal']
    assert.deepEqual(report.scenarios.map((scenario) => scenario.name).sort(), expectedScenarios.sort())
    assert.ok(report.scenarios.every((scenario) => scenario.status === 'passed'))
    const file = [...downloads.values()].find((entry) => entry.url.endsWith(report.artifact))
    assert.equal(file?.sha512, report.sha512, `${target}: tested artifact differs from public candidate`)
  }
  // Persist the actual previous feeds before any stable pointer changes.
  for (const [label, previousBase] of [['stable', `${stable}latest/`], ['legacy', `${root}latest/`]]) {
    for (const manifest of [...manifests, 'latest.json']) {
      const text = await (await response(`${previousBase}${manifest}`)).text()
      await writeFile(join(evidence, `previous-${label}-${manifest}`), text)
    }
  }
}

const verified = []
for (const [url, file] of downloads) {
  const result = await response(url)
  const algorithm = 'sha512'
  const hash = createHash(algorithm)
  let size = 0
  for await (const chunk of result.body) { size += chunk.length; hash.update(chunk) }
  assert.equal(size, file.size, url)
  const checksum = hash.digest('base64')
  assert.equal(checksum, file[algorithm], url)
  verified.push({ url, size, [algorithm]: checksum })
}
if (mode === 'latest') {
  const legacy = await (await response(`${root}latest/latest.json`)).json()
  assert.equal(legacy.version, version)
}
await writeFile(join(evidence, `${mode}-verified.json`), JSON.stringify({ version, tag, commit: process.env.CANDIDATE_COMMIT, verified }, null, 2))
console.log(`Verified ${mode} public GUI feeds and ${verified.length} artifact downloads for ${version}`)
