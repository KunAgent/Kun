import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { artifactProfile, artifactServer, artifactTurn, jsonFile } from './kun-npm-artifact-runtime.mjs'
import { runProcess } from './kun-npm-smoke-process.mjs'
import { FIXTURE_REPLY } from './kun-npm-smoke-model.mjs'

const require = createRequire(import.meta.url)
const { verifyMacAppSigning } = require('../mac-signing-policy.cjs')
const { runPackagedCliSmoke } = require('../smoke-packaged-cli.cjs')

export async function describeDesktop(resources) {
  assert.equal(process.platform, 'darwin', 'Use the corresponding native packaged-app driver on other operating systems')
  const canonical = await realpath(resources)
  const app = dirname(dirname(canonical))
  const signature = verifyMacAppSigning(app, { bundleId: 'com.xingyuzhong.deepseekgui', flavor: 'production' })
  assert(signature, 'Use an actual Developer ID signed desktop artifact')
  const root = join(canonical, 'app.asar.unpacked/kun')
  const build = await jsonFile(join(root, 'dist/runtime-build.json'))
  const appVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' }).trim()
  const cliVersion = (await runProcess(join(canonical, 'bin/kun'), ['--version'])).stdout.trim()
  return { resources: canonical, app, appVersion, cliVersion, signature, build,
    asarSha256: createHash('sha256').update(await readFile(join(canonical, 'app.asar'))).digest('hex'),
    entrySha256: createHash('sha256').update(await readFile(join(root, 'dist/cli/serve-entry.js'))).digest('hex'),
    launch: { command: join(canonical, 'bin/kun'), args: [], packaged: true,
      env: { KUN_PACKAGED_RUNTIME_EXECUTABLE: join(dirname(canonical), 'MacOS/Kun') } } }
}

export async function exerciseArtifactDesktop(context) {
  const resources = context.options['desktop-resources']
  assert(resources, 'Pass --desktop-resources for the desktop built from the current change')
  await context.check('GUI-01.signed-packaged-cli-and-runtime', async () => {
    const desktop = await describeDesktop(resources)
    assert.equal(desktop.build.buildId, context.manifest.kunNpm.buildId, 'Desktop must contain this exact Runtime build')
    const desktopRuntimeVersion = context.manifest.kunNpm.runtimeSourceVersion ?? context.manifest.version
    assert.equal(desktop.build.serviceVersion, desktopRuntimeVersion)
    runPackagedCliSmoke(desktop.resources, { expectedVersion: desktopRuntimeVersion })
    const profile = await artifactProfile(context, 'matching-desktop')
    const server = await artifactServer(context, profile, desktop.launch)
    try {
      const turn = await artifactTurn(server, profile, 'Return the fixture marker from the desktop-bundled runtime')
      const completed = await turn.completed()
      assert.equal(completed.status, 'completed')
      assert(JSON.stringify(completed).includes(FIXTURE_REPLY))
      const listing = await server.api('/v1/threads')
      assert(listing.threads.some(thread => thread.id === turn.thread.id))
      await server.api('/v1/usage')
    } finally { await server.stop() }
    const cli = await runProcess(desktop.launch.command, ['exec', '--config', profile.config,
      '--workspace', profile.workspace, '--list-tools', '--json'],
    { cwd: profile.root, env: { ...profile.env, ...desktop.launch.env, KUN_HOST_NODE_EXECUTABLE: undefined }, timeout: 45_000 })
    assert(JSON.parse(cli.stdout).tools.some(tool => tool.name === 'read'))
    return { ...desktop, launch: undefined, source: 'Fresh local electron-builder --publish never --mac dir --arm64',
      help: true, version: true, tuiDependencyGraph: true, actualTurn: true, tools: true, shutdown: true,
      npmRuntimeVersion: context.manifest.version, desktopRuntimeVersion,
      installedApplicationReplaced: false, notarization: 'Not submitted for local acceptance' }
  })
}
