import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runProcess } from './kun-npm-smoke-process.mjs'

async function resourcesUnder(root) {
  const pending = [root]
  const matches = []
  while (pending.length) {
    const directory = pending.shift()
    if (existsSync(join(directory, 'app.asar')) && existsSync(join(directory, 'app.asar.unpacked/kun'))) {
      matches.push(directory)
      continue
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !['node_modules', 'app.asar.unpacked', '__MACOSX'].includes(entry.name))
        pending.push(join(directory, entry.name))
    }
  }
  assert.equal(matches.length, 1, 'Historical archive must contain exactly one complete desktop payload')
  return matches[0]
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function describeHistoricalRelease(context) {
  const metadata = JSON.parse(await readFile(new URL('../fixtures/kun-npm/historical-release.json', import.meta.url), 'utf8'))
  const target = process.platform + '-' + process.arch
  const asset = metadata.assets[target]
  assert(asset, 'No pinned historical artifact for ' + target)
  const root = join(context.root, 'historical-release')
  await mkdir(root)
  const archive = join(root, asset.name)
  // urllib honors the same proxy/certificate environment as the PTY fixtures.
  // Node fetch does not automatically use an inherited HTTPS_PROXY.
  const download = "import sys,urllib.request,shutil\n" +
    "with urllib.request.urlopen(sys.argv[1],timeout=120) as response,open(sys.argv[2],'xb') as output:\n" +
    " shutil.copyfileobj(response,output,1024*1024)\n"
  await runProcess(process.platform === 'win32' ? 'python' : 'python3',
    ['-c', download, asset.url, archive], { env: context.env, timeout: 180_000 })
  const sha256 = await hashFile(archive)
  assert.equal('sha256:' + sha256, asset.digest, 'Historical published bytes changed')
  const extracted = join(root, 'unpacked')
  await mkdir(extracted)
  if (process.platform === 'darwin') {
    await runProcess('/usr/bin/ditto', ['-x', '-k', archive, extracted], { timeout: 180_000 })
  } else if (process.platform === 'linux') {
    await runProcess('dpkg-deb', ['--extract', archive, extracted], { timeout: 180_000 })
  } else {
    const container = join(root, 'installer')
    await runProcess('7z', ['x', '-y', '-o' + container, archive], { timeout: 180_000 })
    const payload = join(container, '$PLUGINSDIR', 'app-64.7z')
    assert(existsSync(payload), 'Historical NSIS installer has no x64 application payload')
    await runProcess('7z', ['x', '-y', '-o' + extracted, payload], { timeout: 180_000 })
  }
  const resources = await resourcesUnder(extracted)
  const entry = join(resources, 'app.asar.unpacked/kun/dist/cli/serve-entry.js')
  const build = JSON.parse(await readFile(join(dirname(dirname(entry)), 'runtime-build.json'), 'utf8'))
  assert.notEqual(build.buildId, context.manifest.kunNpm.buildId, 'Historical reader must be a different build')
  assert.equal(build.serviceVersion, metadata.appVersion, 'Pinned release must identify its actual Runtime version')
  let command, args, env, signature
  if (process.platform === 'darwin') {
    const app = dirname(dirname(resources))
    await runProcess('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 60_000 })
    const signing = await runProcess('/usr/bin/codesign', ['--display', '--verbose=4', app])
    assert.match(signing.stdout + signing.stderr, /Authority=Developer ID Application:/)
    assert.match(signing.stdout + signing.stderr, /TeamIdentifier=YBR76S5LNP/)
    signature = { verified: true, team: 'YBR76S5LNP', identity: 'Developer ID Application' }
    command = join(resources, 'bin/kun'); args = []
    env = { KUN_PACKAGED_RUNTIME_EXECUTABLE: join(dirname(resources), 'MacOS/Kun') }
  } else {
    // Managed child entrypoints need the actual interpreter, not the Linux
    // product shell wrapper that always dispatches KUN_CLI_ENTRY to serve-entry.
    command = join(dirname(resources), process.platform === 'win32' ? 'Kun.exe' : 'kun-gui.electron-bin')
    args = [entry]
    env = { ELECTRON_RUN_AS_NODE: '1', KUN_PACKAGED_RUNTIME_EXECUTABLE: command }
  }
  const launch = { command, args, env, packaged: true }
  const version = await runProcess(command, [...args, '--version'],
    { cwd: root, env: { ...context.env, ...env, KUN_HOST_NODE_EXECUTABLE: undefined }, timeout: 30_000 })
  assert(version.stdout.includes(build.serviceVersion))
  return { resources, appVersion: metadata.appVersion, cliVersion: version.stdout.trim(), build,
    entrySha256: await hashFile(entry), signature, launch,
    publishedSource: { repository: metadata.repository, tag: metadata.tag, commit: metadata.releaseCommit,
      target, url: asset.url, sha256, officialPublishedAsset: true } }
}
