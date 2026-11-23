import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomBytes } from 'node:crypto'
import { processAlive, runProcess, startProcess, waitUntil } from './kun-npm-smoke-process.mjs'

export async function exerciseInstalledIntegrations(context) {
  const { node, installed, root, env, configValue, workspace, check } = context
  const skills = join(root, 'user-skills')
  const skill = join(skills, 'artifact-skill')
  await mkdir(skill, { recursive: true })
  await writeFile(join(skill, 'skill.json'), JSON.stringify({ id: 'artifact-skill', name: 'Artifact skill',
    description: 'A deterministic fixture skill', entry: 'SKILL.md' }))
  await writeFile(join(skill, 'SKILL.md'), 'Artifact skill body: artifact-skill-loaded\n')
  const config = join(root, 'integrations.json')
  const serverPath = fileURLToPath(new URL('../fixtures/kun-npm/mcp-server.mjs', import.meta.url))
  await writeFile(config, JSON.stringify({ ...configValue, capabilities: {
    skills: { enabled: true, roots: [skills] }, attachments: { enabled: true },
    subagents: { enabled: true, maxParallel: 2 },
    mcp: { enabled: true, servers: { artifact: { enabled: true, transport: 'stdio',
      command: node, args: [serverPath, '--with-descendant'], trustScope: 'user', timeoutMs: 10_000 } } }
  } }))
  const invoke = (args, extra = {}) => runProcess(node, [installed.entry, 'exec', '--config', config,
    '--workspace', workspace, '--json', ...args], { cwd: root, env, timeout: 45_000, ...extra })
  await check('RUN-07.skills-mcp', async () => {
    const listed = JSON.parse((await invoke(['--list-tools'])).stdout)
    const echo = listed.tools.find(tool => tool.name.includes('fixture_echo'))
    assert(echo, 'Configured stdio MCP fixture must appear in the installed tool catalog')
    assert((await invoke(['load_skill', '--args', '{"skill_id":"artifact-skill"}'])).stdout.includes('artifact-skill-loaded'))
    const result = await invoke([echo.name, '--args', '{"value":"installed"}'])
    assert(result.stdout.includes('artifact-mcp:installed'))
    const pid = Number(result.stdout.match(/mcp-pid:(\d+)/)?.[1])
    assert(Number.isSafeInteger(pid) && pid > 0)
    await waitUntil(() => !processAlive(pid), 'stdio MCP process exit after CLI shutdown')
    const descendant = Number(result.stdout.match(/mcp-child:(\d+)/)?.[1])
    assert(Number.isSafeInteger(descendant) && descendant > 0)
    await waitUntil(() => !processAlive(descendant), 'registered MCP descendant exit after its parent closes')
    assert(!listed.tools.some(tool => tool.name === 'computer_use'), 'CLI cannot advertise GUI Computer Use')
    const denied = await invoke(['computer_use', '--args', '{"action":"screenshot"}'], { allowFailure: true })
    assert.notEqual(denied.code, 0)
  })
  const service = startProcess(node, [installed.entry, 'serve', '--config', config, '--port', '0'],
    { cwd: root, env, timeout: 180_000 })
  let endpoint, identity
  const request = async (path, method = 'GET', body, extraHeaders = {}) => {
    const response = await fetch(endpoint + path, { method,
      headers: { authorization: `Bearer ${env.KUN_RUNTIME_TOKEN}`, 'content-type': 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
    const value = await response.text()
    assert(response.ok, `${path}: ${response.status} ${value}`)
    return value ? JSON.parse(value) : null
  }
  const start = async (marker, mode = 'agent', approvalPolicy = 'auto') => {
    const thread = await request('/v1/threads', 'POST', { title: marker, workspace,
      model: 'kun-npm-fixture', mode, approvalPolicy, sandboxMode: 'workspace-write' })
    const turn = await request(`/v1/threads/${thread.id}/turns`, 'POST', {
      prompt: marker, mode, clientSurface: 'api' })
    return { thread, turn, path: `/v1/threads/${thread.id}/turns/${turn.turnId}` }
  }
  const completed = async invocation => waitUntil(async () => {
    const value = await request(invocation.path)
    if (['queued', 'running'].includes(value.status)) return null
    assert.equal(value.status, 'completed', JSON.stringify(value))
    return value
  }, 'integration turn completion', 60_000)
  try {
    const ready = await waitUntil(() => {
      if (service.code !== null) throw Error(service.stderr)
      const line = service.stdout.split('\n').find(line => line.startsWith('KUN_READY '))
      return line ? JSON.parse(line.slice(10)) : null
    }, 'integration serve readiness')
    endpoint = `http://${ready.host}:${ready.port}`; identity = ready.instanceId
    await check('RUN-07.attachment', async () => {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIo0AAAAASUVORK5CYII='
      const { attachment } = await request('/v1/attachments', 'POST', {
        name: 'fixture.png', mimeType: 'image/png', dataBase64: png, workspace })
      assert(attachment.id)
      const stored = await request(`/v1/attachments/${attachment.id}/content?workspace=${encodeURIComponent(workspace)}`)
      assert(stored.dataBase64)
    })
    await check('RUN-09.non-gui-extension', async () => {
      const source = join(root, 'node-extension')
      await mkdir(join(source, 'dist'), { recursive: true })
      await writeFile(join(source, 'kun-extension.json'), JSON.stringify({
        manifestVersion: 1, apiVersion: '1.5.0', publisher: 'artifact', name: 'fixture',
        version: '1.0.0', displayName: 'Artifact fixture', engines: { kun: '*' },
        main: 'dist/main.mjs', activationEvents: ['onTool:echo'],
        contributes: { tools: [{ id: 'echo', description: 'Return the local fixture marker',
          inputSchema: { type: 'object', properties: {} }, sideEffects: 'none' }] },
        permissions: ['tools.register'], stateSchemaVersion: 0
      }))
      await writeFile(join(source, 'README.md'), '# Local artifact fixture\n')
      await writeFile(join(source, 'LICENSE'), 'MIT\n')
      await writeFile(join(source, 'dist/main.mjs'), `export async function activate(context) {
        context.subscriptions.add(await context.tools.registerTool({ id: 'echo', description: 'Return the local fixture marker',
          inputSchema: { type: 'object', properties: {} }, sideEffects: 'none' }, async () => ({ content: { marker: 'artifact-extension-ok' } })))
      }\n`)
      const archive = join(root, 'artifact.fixture-1.0.0.kunx')
      await runProcess(node, [installed.entry, 'extension', 'pack', source, '--output', archive,
        '--data-dir', join(root, 'pack-profile'), '--extension-root', join(root, 'pack-packages'),
        '--extension-data-root', join(root, 'pack-data'), '--json'], { cwd: root, env, timeout: 45_000 })
      await request('/v1/extensions/install', 'POST', {
        source: 'archive', path: archive, grantedPermissions: ['tools.register']
      })
      await request('/v1/extensions/artifact.fixture/permissions', 'PUT', {
        workspaceRoot: await realpath(workspace), expectedVersion: '1.0.0', permissions: ['tools.register']
      })
      const result = await completed(await start('KUN_ARTIFACT_VERIFY_EXTENSION: Use the installed fixture extension tool.'))
      assert(JSON.stringify(result).includes('artifact-extension-ok'), JSON.stringify(result))
    })
    await check('RUN-07.goal-task-plan', async () => {
      const run = await start('KUN_ARTIFACT_VERIFY_GOAL: Create a goal to record a fixture planning task, then mark the goal complete.')
      const turn = await completed(run)
      assert(!turn.items.some(item => item.kind === 'tool_result' && item.isError), JSON.stringify(turn))
      for (const name of ['create_goal', 'task_create', 'update_goal']) {
        assert(turn.items.some(item => item.kind === 'tool_result' && item.toolName === name), name)
      }
      const plan = await completed(await start('KUN_ARTIFACT_VERIFY_PLAN: Save the fixture Markdown plan.', 'plan'))
      assert(plan.items.some(item => item.kind === 'tool_result' && item.toolName === 'create_plan' && !item.isError), JSON.stringify(plan))
      const plans = await import('node:fs/promises').then(fs => fs.readdir(join(workspace, '.kunsdd/plan')))
      assert(plans.some(name => name.endsWith('.md')))
    })
    await check('RUN-08.structured-input', async () => {
      const run = await start('KUN_ARTIFACT_VERIFY_INPUT: Ask the required fixture question and use the answer.')
      const pending = await waitUntil(async () => (await request(run.path)).items
        .find(item => item.kind === 'user_input' && item.status === 'pending'), 'structured input request')
      await request(`/v1/user-inputs/${pending.inputId}`, 'POST', { answers: [{ id: 'choice', label: 'A', value: 'A' }] })
      await completed(run)
    })
    await check('RUN-07.subagent', async () => {
      const result = await completed(await start('KUN_ARTIFACT_VERIFY_CHILD: Delegate to one fixture child and return its result.'))
      assert(result.items.some(item => item.kind === 'tool_result' && item.toolName === 'delegate_task' && !item.isError), JSON.stringify(result))
    })
    await check('RUN-08.allow-deny', async () => {
      for (const decision of ['allow', 'deny']) {
        const run = await start(`KUN_ARTIFACT_VERIFY_APPROVAL_${decision}: Request the fixture file write.`, 'agent', 'always')
        const pending = await waitUntil(async () => (await request(`/v1/approvals?threadId=${run.thread.id}`))
          .approvals[0], 'tool approval request')
        // Reproduce the public approval-consent wire contract without importing
        // the source Runtime. These are fixture-owned actions and credentials.
        const expires = Date.now() + 30_000
        const nonce = randomBytes(24).toString('base64url')
        const signature = createHmac('sha256', env.KUN_RUNTIME_TOKEN)
          .update(`v1\n${pending.approvalId}\n${decision}\n${expires}\n${nonce}`).digest('base64url')
        await request(`/v1/approvals/${pending.approvalId}`, 'POST', { decision }, {
          'x-kun-approval-consent': `v1.${expires}.${nonce}.${signature}`
        })
        await completed(run)
        assert.equal(existsSync(join(workspace, `approval-${decision}.txt`)), decision === 'allow')
      }
    })
  } finally {
    if (service.child.exitCode === null) {
      try { if (endpoint) await request('/v1/runtime/shutdown', 'POST', { instanceId: identity }) }
      catch { service.child.kill('SIGTERM') }
      await service.done
    }
  }
}
