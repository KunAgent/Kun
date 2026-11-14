import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processAlive, smokeEnvironment, startProcess, waitUntil } from './kun-npm-smoke-process.mjs'

export const jsonFile = async path => JSON.parse(await readFile(path, 'utf8'))

export async function artifactProfile(context, name, capabilities = {}) {
  const root = join(context.root, name)
  await mkdir(root, { recursive: true })
  const env = smokeEnvironment(context.node, root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const config = join(root, 'config.json')
  const value = { serve: { host: '127.0.0.1', port: 0, dataDir: env.KUN_DATA_DIR,
    runtimeToken: env.KUN_RUNTIME_TOKEN, apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: context.model.url + '/v1', endpointFormat: 'chat_completions', model: 'kun-npm-fixture',
    approvalPolicy: 'auto', sandboxMode: 'danger-full-access', tokenEconomyMode: false,
    storage: { backend: 'hybrid' } }, capabilities }
  await writeFile(config, JSON.stringify(value))
  return { root, env, workspace, config, value }
}

export async function artifactServer(context, profile, launch = context.launch) {
  const env = { ...profile.env, ...launch.env }
  if (launch.packaged) delete env.KUN_HOST_NODE_EXECUTABLE
  const service = startProcess(launch.command, [...launch.args, 'serve', '--config', profile.config, '--port', '0'],
    { cwd: profile.root, env, timeout: 180_000 })
  try {
    const ready = await waitUntil(() => {
      if (service.child.exitCode !== null || service.child.signalCode !== null) throw Error(service.stderr)
      const line = service.stdout.split('\n').find(line => line.startsWith('KUN_READY '))
      return line ? JSON.parse(line.slice(10)) : null
    }, 'artifact server readiness', 60_000)
    return await connectArtifactServer(service, ready, profile)
  } catch (error) {
    service.child.kill('SIGTERM')
    await service.done
    throw error
  }
}

export async function connectArtifactServer(service, ready, profile) {
  const url = ready.baseUrl ?? `http://${ready.host}:${ready.port}`
  const manager = await jsonFile(join(profile.env.KUN_MANAGER_CONTROL_DIR, 'manager.json'))
  const request = async (path, method = 'GET', body, allowFailure = false) => {
    const response = await fetch(url + path, { method, headers: {
      authorization: `Bearer ${ready.runtimeToken ?? profile.env.KUN_RUNTIME_TOKEN}`, 'content-type': 'application/json'
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
    const text = await response.text()
    if (!allowFailure) assert(response.ok, `${method} ${path}: ${response.status} ${text}\n${service?.stderr.slice(-4000) ?? ''}`)
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  const api = async (...args) => (await request(...args)).body
  const stop = async () => {
    await api('/v1/runtime/shutdown', 'POST', { instanceId: ready.instanceId })
    if (service) {
      const result = await service.done
      assert.equal(result.code, 0, result.stderr)
    }
    await waitUntil(() => !processAlive(manager.pid), 'artifact Manager exit', 20_000)
    await assert.rejects(fetch(url + '/health', { signal: AbortSignal.timeout(500) }))
    await assert.rejects(fetch(manager.baseUrl + '/health', { signal: AbortSignal.timeout(500) }))
  }
  return { service, ready, manager, url, api, request, stop }
}

export async function artifactTurn(server, profile, prompt) {
  const thread = await server.api('/v1/threads', 'POST', { title: prompt.slice(0, 80), workspace: profile.workspace,
    model: 'kun-npm-fixture', approvalPolicy: 'auto', sandboxMode: 'danger-full-access' })
  const turn = await server.api(`/v1/threads/${thread.id}/turns`, 'POST', { prompt, mode: 'agent', clientSurface: 'api' })
  const path = `/v1/threads/${thread.id}/turns/${turn.turnId}`
  const completed = () => waitUntil(async () => {
    const value = await server.api(path)
    return ['queued', 'running'].includes(value.status) ? null : value
  }, 'artifact turn completion', 60_000)
  return { thread, turn, path, completed }
}

export function processBirth(pid) {
  if (!processAlive(pid)) return null
  if (process.platform === 'win32') return JSON.parse(execFileSync('python', [
    fileURLToPath(new URL('../fixtures/kun-npm/windows_processes.py', import.meta.url)), '--birth', String(pid)
  ], { encoding: 'utf8' }))
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() || null }
  catch { return null }
}

export function processTree(roots) {
  if (process.platform === 'win32') return JSON.parse(execFileSync('python', [
    fileURLToPath(new URL('../fixtures/kun-npm/windows_processes.py', import.meta.url)), ...roots.map(String)
  ], { encoding: 'utf8' }))
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8' }).trim().split('\n')
    .map(line => { const [pid, parent, ...birth] = line.trim().split(/\s+/); return {
      pid: Number(pid), parent: Number(parent), birth: birth.join(' ')
    } })
  const selected = new Set(roots)
  for (let previous = -1; selected.size !== previous;) {
    previous = selected.size
    for (const row of rows) if (selected.has(row.parent)) selected.add(row.pid)
  }
  return rows.filter(row => selected.has(row.pid))
}

export async function treeHashes(root) {
  const result = {}
  const { createHash } = await import('node:crypto')
  const visit = async (directory, prefix = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const name = prefix + entry.name
      if (entry.isDirectory()) await visit(path, name + '/')
      else if (entry.isFile()) result[name] = createHash('sha256').update(await readFile(path)).digest('hex')
      else throw Error(`Unexpected profile link: ${path}`)
    }
  }
  await visit(root)
  return result
}
