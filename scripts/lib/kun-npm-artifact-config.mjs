import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { artifactProfile } from './kun-npm-artifact-runtime.mjs'
import { FIXTURE_REPLY } from './kun-npm-smoke-model.mjs'
import { processAlive, runProcess } from './kun-npm-smoke-process.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')

async function assertStopped(profile) {
  const discovery = join(profile.env.KUN_MANAGER_CONTROL_DIR, 'manager.json')
  if (existsSync(discovery)) {
    const manager = JSON.parse(await readFile(discovery, 'utf8'))
    assert(!processAlive(manager.pid), 'One-shot configuration test left a live Manager')
  }
}

export async function exerciseInstalledConfig(context) {
  const { node, installed, root, model, check } = context
  await check('NPM-06.installed-entry-boundaries', async () => {
    const script = "const {npmStartupError}=await import(" +
      JSON.stringify(pathToFileURL(join(installed.root, 'bin/kun.mjs')).href) + ");" +
      "for(const version of ['22.19.0','26.3.9','27.0.0','invalid'])" +
      "if(!npmStartupError(version,process.platform,process.arch))throw Error('unsupported Node accepted');" +
      "for(const [p,a,g] of [['win32','arm64',true],['linux','x64',false],['freebsd','x64',true]])" +
      "if(!npmStartupError('26.12.0',p,a,g))throw Error('unsupported target accepted');" +
      "for(const [p,a] of [['darwin','arm64'],['darwin','x64'],['win32','x64'],['linux','arm64'],['linux','x64']])" +
      "for(const v of ['26.4.0','26.12.0'])if(npmStartupError(v,p,a,true))throw Error('supported target rejected');"
    await runProcess(node, ['--input-type=module', '--eval', script], { cwd: root, env: context.env })
    return { source: 'Installed npm launcher exports, not a source import',
      unsupportedCasesAreFixtures: true, nodeBoundaries: ['22.19.0', '26.3.9', '27.0.0'],
      unsupportedTargets: ['win32-arm64', 'linux-musl', 'freebsd-x64'] }
  })
  await check('RUN-02.config-env-cli-precedence', async () => {
    const verified = []
    for (const layer of ['config', 'environment', 'arguments']) {
      const profile = await artifactProfile(context, 'config-precedence-' + layer)
      const env = { ...profile.env }
      delete env.DEEPSEEK_API_KEY
      const gui = { version: 1, provider: { providers: [{ id: 'conflicting-gui', name: 'Conflicting GUI',
        baseUrl: model.url + '/gui/v1', apiKey: 'npm-fixture-gui-secret',
        endpointFormat: 'chat_completions', models: ['gui-model'] }] },
      agents: { kun: { dataDir: env.KUN_DATA_DIR, providerId: 'conflicting-gui',
        model: 'gui-model', port: 0, runtimeToken: 'fixture-gui-token' } } }
      await writeFile(env.KUN_GUI_SETTINGS_PATH, JSON.stringify(gui))
      const guiBefore = await readFile(env.KUN_GUI_SETTINGS_PATH, 'utf8')
      profile.value.serve = { ...profile.value.serve, apiKey: 'npm-fixture-config-secret',
        baseUrl: model.url + '/config/v1', model: 'config-model', endpointFormat: 'chat_completions' }
      await writeFile(profile.config, JSON.stringify(profile.value))
      const configBefore = await readFile(profile.config, 'utf8')
      let expected = { path: '/config/v1/chat/completions', model: 'config-model',
        key: 'npm-fixture-config-secret' }
      if (layer !== 'config') {
        Object.assign(env, { KUN_BASE_URL: model.url + '/environment/v1', KUN_MODEL: 'environment-model',
          KUN_ENDPOINT_FORMAT: 'responses', DEEPSEEK_API_KEY: 'npm-fixture-environment-secret' })
        expected = { path: '/environment/v1/responses', model: 'environment-model',
          key: 'npm-fixture-environment-secret' }
      }
      const args = ['run', '--config', profile.config, '--workspace', profile.workspace, '--json']
      if (layer === 'arguments') {
        args.push('--base-url', model.url + '/arguments/v1', '--model', 'arguments-model',
          '--endpoint-format', 'messages')
        expected = { ...expected, path: '/arguments/v1/messages', model: 'arguments-model' }
      }
      const before = model.requests.length
      const result = await runProcess(node, [installed.entry, ...args, 'Return the configuration fixture marker'],
        { cwd: profile.root, env, timeout: 30_000 })
      const output = JSON.parse(result.stdout)
      assert.equal(output.status, 'completed')
      assert(result.stdout.includes(FIXTURE_REPLY))
      const requests = model.requests.slice(before)
      assert(requests.length > 0)
      assert(requests.every(request => request.path === expected.path && request.body.model === expected.model),
        'Explicit config/environment/CLI selection was overwritten')
      assert(requests.every(request => request.credentialSha256 === digest(expected.key)), 'Credential precedence changed')
      assert.equal(await readFile(profile.config, 'utf8'), configBefore, 'Explicit config was rewritten')
      assert.equal(await readFile(env.KUN_GUI_SETTINGS_PATH, 'utf8'), guiBefore, 'Conflicting GUI settings were rewritten')
      assert(!result.stdout.includes(expected.key) && !result.stderr.includes(expected.key), 'Credential appeared in CLI output')
      await assertStopped(profile)
      verified.push({ layer, requestPath: expected.path, model: expected.model, exitCode: result.code,
        requestCount: requests.length, credentialMatches: true, configUnchanged: true, guiUnchanged: true })
    }
    return { verified, homeChanged: false }
  })
  await check('RUN-02.no-gui-config', async () => {
    const profile = await artifactProfile(context, 'config-without-gui')
    assert(!existsSync(profile.env.KUN_GUI_SETTINGS_PATH))
    const result = await runProcess(node, [installed.entry, 'run', '--config', profile.config,
      '--workspace', profile.workspace, '--json', 'Return fixture marker without desktop settings'],
    { cwd: profile.root, env: profile.env, timeout: 30_000 })
    assert.equal(JSON.parse(result.stdout).status, 'completed')
    assert(result.stdout.includes(FIXTURE_REPLY))
    assert(!existsSync(profile.env.KUN_GUI_SETTINGS_PATH))
    await assertStopped(profile)
    return { exitCode: result.code, desktopSettingsAbsent: true }
  })
  await check('RUN-02.missing-credentials', async () => {
    const profile = await artifactProfile(context, 'config-missing-credentials')
    const env = { ...profile.env }
    delete env.DEEPSEEK_API_KEY
    profile.value.serve.apiKey = ''
    await writeFile(profile.config, JSON.stringify(profile.value))
    const before = model.requests.length
    const result = await runProcess(node, [installed.entry, 'run', '--config', profile.config,
      '--workspace', profile.workspace, '--json', 'This request must fail before contacting the fixture model'],
    { cwd: profile.root, env, timeout: 30_000, allowFailure: true })
    assert.notEqual(result.code, 0)
    assert.equal(result.timedOut, false)
    assert.match(result.stdout + result.stderr, /api[_ -]?key|credential/i)
    assert.match(result.stdout + result.stderr, /config|DEEPSEEK_API_KEY|environment/i)
    assert.equal(model.requests.length, before, 'Missing credentials sent a model request')
    assert(!/npm-fixture-(?:config|environment|gui)-secret/.test(result.stdout + result.stderr))
    await assertStopped(profile)
    return { exitCode: result.code, requestSent: false, boundedFailure: true, actionableHint: true }
  })
  await check('RUN-02.invalid-config', async () => {
    const profile = await artifactProfile(context, 'config-invalid')
    const before = model.requests.length
    await writeFile(profile.config, '{"serve":')
    const result = await runProcess(node, [installed.entry, 'run', '--config', profile.config, 'Invalid config fixture'],
      { cwd: profile.root, env: profile.env, timeout: 30_000, allowFailure: true })
    assert.notEqual(result.code, 0)
    assert.equal(result.timedOut, false)
    assert.match(result.stdout + result.stderr, /config|parse|JSON/i)
    assert.equal(model.requests.length, before)
    await assertStopped(profile)
    return { exitCode: result.code, requestSent: false, boundedFailure: true }
  })
}

export async function exerciseInstalledJson({ invoke, common, root, check, model }) {
  await check('RUN-01.run-json', async () => {
    const before = model.requests.length
    const result = await invoke(['run', ...common, '--json', 'Return the JSON fixture marker'])
    const output = JSON.parse(result.stdout.trim())
    assert.equal(output.status, 'completed')
    assert.equal(typeof output.threadId, 'string')
    assert.equal(typeof output.turnId, 'string')
    assert(Array.isArray(output.items) && JSON.stringify(output.items).includes(FIXTURE_REPLY))
    assert(model.requests.length > before)
    assert(!result.stdout.includes('npm-smoke-fixture-key') && !result.stderr.includes('npm-smoke-fixture-key'))
    const rejected = await invoke(['run', ...common, '--json', '--jsonl', 'Conflicting output flags'],
      { allowFailure: true, timeout: 30_000 })
    assert.notEqual(rejected.code, 0)
    assert.match(rejected.stderr, /mutually exclusive/)
    return { exitCode: result.code, singleJsonDocument: true, status: output.status,
      itemCount: output.items.length, conflictingFlagsExitCode: rejected.code }
  })
  await check('RUN-01.prompt-file', async () => {
    const path = join(root, 'prompt file 中文.txt')
    await mkdir(root, { recursive: true })
    const prompt = 'Return the prompt-file fixture marker'
    await writeFile(path, prompt)
    const before = model.requests.length
    const result = await invoke(['run', ...common, '--prompt-file', path])
    assert(result.stdout.includes(FIXTURE_REPLY))
    assert(model.requests.slice(before).some(request => JSON.stringify(request.body).includes(prompt)))
    return { exitCode: result.code, promptSource: 'actual UTF-8 file in a space/non-ASCII path' }
  })
}
