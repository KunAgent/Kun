import assert from 'node:assert/strict'
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { artifactProfile, artifactServer, jsonFile, treeHashes } from './kun-npm-artifact-runtime.mjs'
import { FIXTURE_REPLY } from './kun-npm-smoke-model.mjs'
import { runProcess } from './kun-npm-smoke-process.mjs'

export async function exerciseArtifactHistory(context) {
  assert(context.options['historical-resources'] || context.options.history, 'Provide a real historical desktop artifact')
  const historical = context.options.history
    ? await (await import('./kun-npm-artifact-historical-release.mjs')).describeHistoricalRelease(context)
    : await (await import('./kun-npm-artifact-desktop.mjs')).describeDesktop(context.options['historical-resources'])
  assert.notEqual(historical.build.serviceVersion, context.manifest.version, 'History needs a genuinely different version')
  const profile = await artifactProfile(context, 'historical-data', {
    memory: { enabled: true }, attachments: { enabled: true }
  })
  context.historyProfile = profile
  let expected
  const validate = async server => {
    const thread = await server.api(`/v1/threads/${expected.threadId}`)
    assert(JSON.stringify(thread).includes(FIXTURE_REPLY))
    assert.equal(thread.id, expected.threadId)
    assert.deepEqual((await server.api(`/v1/threads/${expected.threadId}/goal`)).goal, expected.goal)
    assert.deepEqual((await server.api(`/v1/threads/${expected.threadId}/tasks`)).tasks, expected.tasks)
    const memories = (await server.api(`/v1/memory?workspace=${encodeURIComponent(profile.workspace)}`)).memories
    assert(memories.some(memory => memory.id === expected.memoryId && memory.content === 'historical-memory-marker'))
    const attachment = await server.api(`/v1/attachments/${expected.attachmentId}/content?workspace=${encodeURIComponent(profile.workspace)}`)
    assert.equal(attachment.dataBase64, expected.attachmentData)
    const usage = await server.api('/v1/usage?group_by=thread')
    assert(JSON.stringify(usage).includes(expected.threadId), 'Persisted usage must still refer to the historical thread')
    assert.equal(await readFile(profile.config, 'utf8'), expected.configText)
    assert.equal(await readFile(profile.env.KUN_MANAGER_SETTINGS_PATH, 'utf8'), expected.settingsText)
  }
  await context.check('DATA-01.historical-artifact-origin', async () => {
    const server = await artifactServer(context, profile, historical.launch)
    try {
      const thread = await server.api('/v1/threads', 'POST', { title: 'Historical fixture corpus',
        workspace: profile.workspace, model: 'kun-npm-fixture', approvalPolicy: 'auto', sandboxMode: 'danger-full-access' })
      const base = `/v1/threads/${thread.id}`
      // Historical compatibility needs genuine old data, not a regression of
      // the old binary's post-turn lease settlement. Seed definitions while
      // its thread is idle, then execute the real model turn without retries.
      await server.api(base + '/goal', 'POST', { objective: 'Preserve the historical fixture goal', status: 'paused' })
      await server.api(base + '/tasks', 'POST', { clientRequestId: 'historical-task', title: 'Historical task definition' })
      const { memory } = await server.api('/v1/memory', 'POST', { content: 'historical-memory-marker',
        scope: 'workspace', workspace: profile.workspace })
      const attachmentData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIo0AAAAASUVORK5CYII='
      const { attachment } = await server.api('/v1/attachments', 'POST', { name: 'historical.png',
        mimeType: 'image/png', dataBase64: attachmentData, workspace: profile.workspace })
      const settingsResponse = await fetch(server.manager.baseUrl + '/v1/documents/settings', {
        headers: { authorization: `Bearer ${server.manager.managerToken}` }, signal: AbortSignal.timeout(5_000) })
      assert(settingsResponse.ok)
      const { snapshot } = await settingsResponse.json()
      const settingsText = JSON.stringify({ version: 1, fixtureSetting: 'historical-settings-marker' }) + '\n'
      const saved = await fetch(server.manager.baseUrl + '/v1/documents/settings', { method: 'PUT',
        headers: { authorization: `Bearer ${server.manager.managerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: snapshot.revision, value: settingsText }), signal: AbortSignal.timeout(5_000) })
      assert(saved.ok, await saved.text())
      const turn = await server.api(base + '/turns', 'POST', {
        prompt: 'Return the historical fixture marker', mode: 'agent', clientSurface: 'api' })
      const { waitUntil } = await import('./kun-npm-smoke-process.mjs')
      const completed = await waitUntil(async () => {
        const value = await server.api(base + '/turns/' + turn.turnId)
        return ['queued', 'running'].includes(value.status) ? null : value
      }, 'historical fixture turn completion', 60_000)
      assert.equal(completed.status, 'completed')
      assert(JSON.stringify(completed).includes(FIXTURE_REPLY))
      const goal = await server.api(base + '/goal')
      const tasks = await server.api(base + '/tasks')
      expected = { threadId: thread.id, goal: goal.goal, tasks: tasks.tasks,
        memoryId: memory.id, attachmentId: attachment.id, attachmentData, settingsText,
        configText: await readFile(profile.config, 'utf8') }
      await validate(server)
      return { source: { ...historical, launch: undefined }, createdByHistoricalBinary: true, definitionsCreatedWhileIdle: true,
        categories: ['thread', 'turn', 'configuration', 'settings', 'memory', 'usage', 'goal', 'task', 'attachment'] }
    } finally { await server.stop() }
  })
  const ownerInstances = new Set()
  for (const kind of ['npm', 'replacement-path', ...(context.options.history ? [] : ['desktop'])]) {
    await context.check(`DATA-01.reopen-${kind}`, async () => {
      let launch = context.launch
      const replacement = join(context.root, 'replacement package')
      if (kind === 'replacement-path') {
        await rename(context.installed.root, replacement)
        launch = { command: context.node, args: [join(replacement, 'bin/kun.mjs')] }
      }
      try {
        if (kind === 'desktop') {
          assert(context.options['desktop-resources'], 'A matching desktop artifact is required for sequential npm/desktop reuse')
          launch = (await (await import('./kun-npm-artifact-desktop.mjs')).describeDesktop(context.options['desktop-resources'])).launch
        }
        const server = await artifactServer(context, profile, launch)
        try {
          assert(!ownerInstances.has(server.ready.instanceId), 'Reopening must acquire a new Runtime identity')
          ownerInstances.add(server.ready.instanceId)
          await validate(server)
          const turn = await server.api(`/v1/threads/${expected.threadId}/turns`, 'POST', {
            prompt: 'Return another fixture marker after reopening', mode: 'agent', clientSurface: 'api' })
          const { waitUntil } = await import('./kun-npm-smoke-process.mjs')
          const completed = await waitUntil(async () => {
            const value = await server.api(`/v1/threads/${expected.threadId}/turns/${turn.turnId}`)
            return ['queued', 'running'].includes(value.status) ? null : value
          }, 'reopened historical turn')
          assert.equal(completed.status, 'completed')
          await validate(server)
          return { sameDataDirectory: true, independentOwnerInstanceId: server.ready.instanceId,
            preservedCategories: ['thread', 'configuration', 'settings', 'memory', 'usage', 'goal', 'task', 'attachment'] }
        } finally { await server.stop() }
      } finally {
        if (kind === 'replacement-path') await rename(replacement, context.installed.root)
      }
    })
  }
  await context.check('DATA-02.old-reader-refuses-unsupported-schema', async () => {
    const incompatible = await artifactProfile(context, 'unsupported-old-reader')
    await cp(profile.env.KUN_DATA_DIR, incompatible.env.KUN_DATA_DIR, { recursive: true })
    const source = join(incompatible.root, 'fixture-extension')
    await mkdir(join(source, 'dist'), { recursive: true })
    await writeFile(join(source, 'kun-extension.json'), JSON.stringify({ manifestVersion: 1,
      apiVersion: '1.0.0', publisher: 'artifact', name: 'history', version: '1.0.0', displayName: 'History fixture',
      engines: { kun: '*' }, main: 'dist/main.mjs', activationEvents: [], contributes: {}, permissions: [], stateSchemaVersion: 0 }))
    await writeFile(join(source, 'dist/main.mjs'), 'export function activate() {}\n')
    await runProcess(context.launch.command, [...context.launch.args, 'extension', 'install', '--development', source,
      '--no-enable', '--accept-permissions', '--data-dir', incompatible.env.KUN_DATA_DIR,
      '--extension-root', join(incompatible.env.KUN_DATA_DIR, 'extensions'),
      '--extension-data-root', join(incompatible.env.KUN_DATA_DIR, 'extension-data'), '--json'],
    { cwd: incompatible.root, env: incompatible.env, timeout: 30_000 })
    const registryPath = join(incompatible.env.KUN_DATA_DIR, 'extensions/registry.json')
    const registry = await jsonFile(registryPath)
    registry.schemaVersion = 999
    await writeFile(registryPath, JSON.stringify(registry))
    const before = await treeHashes(incompatible.env.KUN_DATA_DIR)
    const env = { ...incompatible.env, ...historical.launch.env }
    delete env.KUN_HOST_NODE_EXECUTABLE
    const result = await runProcess(historical.launch.command, [...historical.launch.args, 'extension', 'list',
      '--data-dir', incompatible.env.KUN_DATA_DIR,
      '--extension-root', join(incompatible.env.KUN_DATA_DIR, 'extensions'),
      '--extension-data-root', join(incompatible.env.KUN_DATA_DIR, 'extension-data'), '--json'],
    { cwd: incompatible.root, env, timeout: 30_000, allowFailure: true })
    assert.notEqual(result.code, 0, result.stdout)
    assert.match(result.stderr + result.stdout, /EXTENSION_REGISTRY_VERSION_UNSUPPORTED|Unsupported extension registry version/i)
    assert.deepEqual(await treeHashes(incompatible.env.KUN_DATA_DIR), before, 'Incompatible reader changed protected data')
    return { readerVersion: historical.build.serviceVersion, exitCode: result.code,
      unchangedFiles: Object.keys(before).length,
      fixtureKind: 'Explicit unsupported-format fault injection on a COPY; not a claimed historical product schema' }
  })
}
