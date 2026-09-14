import { build } from 'esbuild'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createOwnedServiceManagerSession, type OwnedServiceManagerSession } from './owned-service-manager-session.js'
import { readManagerDiscovery } from './manager-discovery.js'
import { runtimeProcessIsAlive } from '../server/runtime-process-identity.js'
import { resumeOwnedProcessAdmission, shutdownOwnedProcesses } from '../process/owned-process.js'
import { bindRuntimeManagerDataPlane, connectInjectedServiceManager } from './owned-manager-binding.js'
import { launchServiceManagerProcess } from './manager-launch.js'
import { runManagerRetireCommand } from '../cli/manager-retire.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import { HistoryReferenceStore } from '../history/history-reference-store.js'

const roots: string[] = []
const sessions: OwnedServiceManagerSession[] = []
let bundleRoot: string
let managerEntry: string
let sessionEntry: string
const parents: ChildProcess[] = []

beforeAll(async () => {
  bundleRoot = await realpath(await mkdtemp(join(tmpdir(), 'kun-owned-manager-entry-')))
  managerEntry = join(bundleRoot, 'manager-entry.mjs')
  sessionEntry = join(bundleRoot, 'owned-session.mjs')
  await symlink(resolve(import.meta.dirname, '../../node_modules'), join(bundleRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await build({ entryPoints: [resolve(import.meta.dirname, 'manager-entry.ts')], outfile: managerEntry,
    bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' })
  await build({ entryPoints: [resolve(import.meta.dirname, 'owned-service-manager-session.ts')], outfile: sessionEntry,
    bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' })
}, 30_000)

afterEach(async (context) => {
  if (context.task.result?.state === 'fail') {
    for (const root of roots) console.error(await readFile(join(root, 'control', 'manager.log'), 'utf8').catch(() => ''))
  }
  for (const child of parents.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await Promise.allSettled(sessions.map((session) => session.close({ deadline: Date.now() + 5_000 })))
  await shutdownOwnedProcesses({ graceMs: 0, timeoutMs: 5_000 })
  await Promise.allSettled(sessions.splice(0).map((session) => session.close({ deadline: Date.now() + 1_000 })))
  resumeOwnedProcessAdmission()
  const deadline = Date.now() + 30_000
  for (const root of roots) {
    const record = await readManagerDiscovery(join(root, 'control')).catch(() => null)
    while (record && runtimeProcessIsAlive(record.pid, record) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (record && runtimeProcessIsAlive(record.pid, record)) throw new Error('Isolated test Manager failed to exit; retaining its fixture directory')
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}, 35_000)
afterAll(async () => { await rm(bundleRoot, { recursive: true, force: true }) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-owned-manager-'))
  roots.push(root)
  const session = createOwnedServiceManagerSession({ ownerKind: 'gui' })
  sessions.push(session)
  return { session, input: { flavor: 'production' as const, dataDir: join(root, 'data'),
    controlDir: join(root, 'control'), settingsPath: join(root, 'settings.json'), timeoutMs: 10_000,
    launch: { command: process.execPath, args: [managerEntry], runAsNode: false } } }
}

describe('owned Service Manager real process lifecycle', () => {
  it('stops the actual Manager process and listener, then reopens the original data', async () => {
    const { session, input } = await fixture()
    const first = await session.ensure(input)
    const discovery = first.discovery
    const headers = { authorization: `Bearer ${discovery.managerToken}`, 'content-type': 'application/json' }
    await expect(fetch(`${discovery.baseUrl}/v1/documents/settings`, { method: 'PUT', headers,
      body: JSON.stringify({ expectedRevision: 0, value: JSON.stringify({ preserved: 'history' }) }) })).resolves.toMatchObject({ ok: true })
    await session.stop()
    expect(runtimeProcessIsAlive(discovery.pid, discovery)).toBe(false)
    await expect(fetch(`${discovery.baseUrl}/health`)).rejects.toThrow()
    expect(await readManagerDiscovery(input.controlDir)).toBeNull()
    const next = await session.ensure(input)
    expect(next.discovery.appOwner?.ownerSessionId).toBe(discovery.appOwner?.ownerSessionId)
    expect(next.discovery.appOwner?.generation).toBeGreaterThan(discovery.appOwner!.generation)
    expect(next.discovery.instanceId).not.toBe(discovery.instanceId)
    expect(JSON.parse(await readFile(input.settingsPath, 'utf8'))).toMatchObject({ preserved: 'history' })
  }, 20_000)

  it('requires private owner control and rejects a wrong Runtime generation', async () => {
    const { session, input } = await fixture()
    const manager = await session.ensure(input)
    const { discovery } = manager
    const response = await fetch(`${discovery.baseUrl}/v1/manager/shutdown`, {
      method: 'POST', headers: { authorization: `Bearer ${discovery.managerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: discovery.instanceId })
    })
    expect(response.status).toBe(403)
    expect(runtimeProcessIsAlive(discovery.pid, discovery)).toBe(true)
    await expect(connectInjectedServiceManager({ owner: { ...discovery.appOwner!, generation: 999 }, dataDir: input.dataDir,
      env: { KUN_MANAGER_CONTROL_DIR: input.controlDir, KUN_MANAGER_BASE_URL: discovery.baseUrl,
        KUN_MANAGER_INSTANCE_ID: discovery.instanceId, KUN_MANAGER_TOKEN: discovery.managerToken } }))
      .rejects.toThrow('generation')
  }, 20_000)

  it('constructs Manager-backed Runtime history stores when the configured data directory is a symlink', async () => {
    const { session, input } = await fixture()
    const manager = await session.ensure(input)
    const alias = `${input.dataDir}-alias`
    await symlink(manager.discovery.dataDir, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const options = { dataDir: alias }
    const env = { KUN_MANAGER_CONTROL_DIR: input.controlDir, KUN_MANAGER_BASE_URL: manager.discovery.baseUrl,
      KUN_MANAGER_INSTANCE_ID: manager.discovery.instanceId, KUN_MANAGER_TOKEN: manager.discovery.managerToken }
    const binding = await connectInjectedServiceManager({ owner: manager.discovery.appOwner!, dataDir: alias, env })
    bindRuntimeManagerDataPlane(options, binding, env)
    configureManagerAtomicJsonClient({ baseUrl: binding.discovery.baseUrl, token: binding.discovery.managerToken,
      dataDir: binding.discovery.dataDir })
    try {
      const history = new HistoryReferenceStore(options.dataDir)
      await expect(history.get('unwritten-history-reference')).resolves.toBeNull()
      expect(history.directory).toBe(join(binding.discovery.dataDir, 'history-references'))
    } finally { configureManagerAtomicJsonClient(null) }
  }, 20_000)

  it('keeps the session reservation between Manager generations', async () => {
    const { session, input } = await fixture()
    await session.ensure(input)
    await session.stop()
    const foreign = createOwnedServiceManagerSession({ ownerKind: 'tui' })
    sessions.push(foreign)
    await expect(foreign.ensure({ ...input, flavor: 'development', controlDir: `${input.controlDir}-other` }))
      .rejects.toThrow('already owned')
    await session.close()
    await expect(foreign.ensure(input)).resolves.toHaveProperty('discovery.appOwner.ownerKind', 'tui')
  }, 20_000)

  it('cancels pending readiness and reaps its exact process before close resolves', async () => {
    const { session, input } = await fixture()
    const started = session.ensure({ ...input, timeoutMs: 30_000,
      launch: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], runAsNode: false } })
    const result = started.catch((error: unknown) => error)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const before = Date.now()
    await session.close({ deadline: before + 3_000 })
    expect(Date.now() - before).toBeLessThan(3_000)
    expect(await result).toBeInstanceOf(Error)
    expect(await readManagerDiscovery(input.controlDir)).toBeNull()
    await expect(session.ensure(input)).rejects.toThrow('stopping')
  }, 10_000)

  it('keeps Manager writable until a Runtime finishes after its application owner is killed', async () => {
    const { session, input } = await fixture()
    const fixturePath = join(bundleRoot, 'owner-fixture.mjs')
    await writeFile(fixturePath, `
import { spawn } from 'node:child_process';
import { createOwnedServiceManagerSession } from ${JSON.stringify(sessionEntry)};
const input = JSON.parse(process.env.KUN_LIFECYCLE_TEST_INPUT);
const session = createOwnedServiceManagerSession({ ownerKind: 'gui' });
const manager = await session.ensure(input);
const runtime = spawn(process.execPath, ['-e', ${JSON.stringify(`
const http = require('node:http');
const manager = JSON.parse(process.env.KUN_LIFECYCLE_TEST_MANAGER);
let closing = false;
const server = http.createServer((request, response) => {
  response.end('{}');
  if (request.url !== '/v1/runtime/shutdown') return;
  close();
});
function close() {
  if (closing) return;
  closing = true;
  setTimeout(async () => {
    const result = await fetch(manager.baseUrl + '/v1/documents/settings', {
      method: 'PUT', headers: { authorization: 'Bearer ' + manager.managerToken, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, value: JSON.stringify({ preserved: 'last-runtime-write' }) })
    });
    server.close(() => process.exit(result.ok ? 0 : 71));
  }, 200);
}
process.on('disconnect', close);
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
`)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, KUN_LIFECYCLE_TEST_MANAGER: JSON.stringify(manager.discovery) } });
const ready = await new Promise((resolve, reject) => { runtime.once('message', resolve); runtime.once('error', reject); });
const registration = { flavor: 'production', instanceId: 'test-runtime', pid: runtime.pid,
  startedAt: new Date().toISOString(), host: '127.0.0.1', port: ready.port,
  baseUrl: 'http://127.0.0.1:' + ready.port, runtimeToken: 'test-token', appOwner: manager.discovery.appOwner };
const response = await fetch(manager.discovery.baseUrl + '/v1/runtimes/production/register', {
  method: 'PUT', headers: { authorization: 'Bearer ' + manager.discovery.managerToken, 'content-type': 'application/json' },
  body: JSON.stringify(registration)
});
if (!response.ok) throw new Error('Runtime registration failed ' + response.status);
process.send({ manager: manager.discovery, runtime: registration });
setInterval(() => {}, 1000);
`)
    const parent = spawn(process.execPath, [fixturePath], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, KUN_LIFECYCLE_TEST_INPUT: JSON.stringify(input) }
    })
    parents.push(parent)
    const records = await new Promise<{ manager: { pid: number; startedAt: string; baseUrl: string }; runtime: { pid: number; startedAt: string } }>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error('Owner fixture readiness timed out')), 8_000)
      parent.once('message', (value) => { clearTimeout(timeout); accept(value as never) })
      parent.once('error', reject)
      parent.stderr?.on('data', (data) => { if (String(data).includes('Error:')) reject(new Error(String(data))) })
    })
    parent.kill('SIGKILL')
    const deadline = Date.now() + 5_000
    while (runtimeProcessIsAlive(records.manager.pid, records.manager) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(runtimeProcessIsAlive(records.runtime.pid, records.runtime)).toBe(false)
    expect(runtimeProcessIsAlive(records.manager.pid, records.manager)).toBe(false)
    await expect(fetch(`${records.manager.baseUrl}/health`)).rejects.toThrow()
    expect(JSON.parse(await readFile(input.settingsPath, 'utf8'))).toMatchObject({ preserved: 'last-runtime-write' })
    await expect(session.ensure(input)).resolves.toHaveProperty('discovery.appOwner.ownerSessionId', session.ownerSessionId)
  }, 20_000)

  it('offers explicit authenticated retirement for an idle legacy daemon without touching owned Managers', async () => {
    const { session, input } = await fixture()
    const { child } = await launchServiceManagerProcess({ ...input,
      launch: { ...input.launch, env: { KUN_APP_SESSION_OWNER: '', KUN_APP_SESSION_RESERVATION: '' } } })
    parents.push(child)
    const deadline = Date.now() + 10_000
    let legacy = await readManagerDiscovery(input.controlDir)
    while (!legacy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      legacy = await readManagerDiscovery(input.controlDir)
    }
    expect(legacy).not.toBeNull()
    const output: string[] = []
    const io = { stdout: { write: (value: string) => output.push(value) },
      stderr: { write: (value: string) => output.push(value) },
      env: { KUN_MANAGER_CONTROL_DIR: input.controlDir, KUN_MANAGER_SETTINGS_PATH: input.settingsPath } }
    expect(await runManagerRetireCommand(['retire', '--data-dir', input.dataDir], io)).toBe(0)
    expect(runtimeProcessIsAlive(legacy!.pid, legacy!)).toBe(false)
    expect(output.join('')).toContain('Existing data is preserved')
    const owned = await session.ensure(input)
    expect(await runManagerRetireCommand(['retire', '--data-dir', input.dataDir], io)).toBe(70)
    expect(runtimeProcessIsAlive(owned.discovery.pid, owned.discovery)).toBe(true)
  }, 20_000)
})
