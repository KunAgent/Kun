const assert = require('node:assert/strict')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, join } = require('node:path')
const test = require('node:test')
const { prerelease } = require('semver')
const { parse } = require('yaml')
const { Arch } = require('builder-util')
const { Platform } = require('app-builder-lib/out/core')
const { getPublishConfigs } = require('app-builder-lib/out/publish/PublishManager')
const { createUpdateInfoTasks, writeUpdateInfoFiles } = require('app-builder-lib/out/publish/updateInfoBuilder')

function releaseConfig(channel, version) {
  const key = require.resolve('../electron-builder.config.cjs')
  const values = { KUN_APP_FLAVOR: 'production', KUN_UPDATE_CHANNEL: channel, KUN_APP_VERSION: version }
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  delete require.cache[key]
  try { return require(key) } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete require.cache[key]
  }
}

for (const [channel, version] of [['stable', '0.4.1'], ['frontier', '0.0.0-dev-20261022-1659']]) {
  test(`${channel} packages generate latest manifests inside their own update channel`, async (t) => {
    const config = releaseConfig(channel, version)
    assert.ok(config.publish[0].url.endsWith(`/channels/${channel}/latest/`))
    const dir = await mkdtemp(join(tmpdir(), 'kun-update-manifest-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const cases = [
      [Platform.LINUX, Arch.arm64, 'Kun-build-linux-arm64.AppImage', 'latest-linux-arm64.yml'],
      [Platform.LINUX, Arch.x64, 'Kun-build-linux-x86_64.AppImage', 'latest-linux.yml'],
      [Platform.WINDOWS, Arch.x64, 'Kun-build-win-x64.exe', 'latest.yml'],
      [Platform.MAC, Arch.arm64, 'Kun-build-mac-arm64.zip', 'latest-mac.yml']
    ]
    for (const [platform, arch, artifact, manifest] of cases) {
      const appInfo = { version, channel: prerelease(version)?.[0] ?? null }
      const packager = {
        config, appInfo, platform, platformSpecificBuildOptions: {},
        info: { config, appInfo, metadata: { dependencies: { 'electron-updater': '6.8.9' } } },
        expandMacro: (value) => value, getResource: async () => null
      }
      const publishers = await getPublishConfigs(packager, null, arch, true)
      const tasks = await createUpdateInfoTasks({
        packager, arch, file: join(dir, artifact), target: { outDir: dir },
        updateInfo: { sha512: 'fixture-digest', size: 42 }
      }, publishers)
      assert.deepEqual(tasks.map(({ file }) => basename(file)), [manifest])
      await writeUpdateInfoFiles(tasks, { emitArtifactCreated: async () => {} })
      const metadata = parse(await readFile(join(dir, manifest), 'utf8'))
      assert.equal(metadata.version, version)
      assert.equal(metadata.files[0].url, artifact)
      assert.equal(metadata.files[0].sha512, 'fixture-digest')
    }
    assert.deepEqual((await readdir(dir)).sort(), cases.map((entry) => entry[3]).sort())
  })
}
