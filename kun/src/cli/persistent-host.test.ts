import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRuntimeCapabilityManifest } from '../contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
import { PersistentHost, persistentHostEnvironment } from './persistent-host.js'
import { runHostCommand } from './host-cli.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(ready = true) {
  const root = await mkdtemp(join(tmpdir(), 'kun-persistent-host-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'fixture.cjs')
  const capabilities = buildRuntimeCapabilityManifest({ model: modelCapabilitiesForModel('fixture') })
  await writeFile(script, `
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
fs.writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid));
${ready ? '' : "setInterval(() => {}, 1000); return;"}
const startedAt = new Date().toISOString(), instanceId = 'fixture-' + process.pid;
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + process.env.KUN_RUNTIME_TOKEN) { res.writeHead(401); res.end(); return; }
  if (req.url === '/v1/runtime/info') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(info)); return; }
  if (req.url === '/v1/runtime/shutdown') { let body = ''; req.on('data', x => body += x); req.on('end', () => {
    if (JSON.parse(body).instanceId !== instanceId) { res.writeHead(409); res.end(); return; }
    res.end('{}'); server.close(() => process.exit(0));
  }); return; }
  res.writeHead(404); res.end();
});
let info;
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  info = { host: '127.0.0.1', port, dataDir: ${JSON.stringify(root)}, instanceId, pid: process.pid,
    serviceVersion: 'fixture', startedAt, launchMode: 'foreground', capabilities: ${JSON.stringify(capabilities)} };
  fs.writeFileSync(path.join(process.env.KUN_RUNTIME_DISCOVERY_DIR, 'runtime.json'), JSON.stringify({
    version: 2, ...info, capabilities: undefined, dataDir: undefined,
    baseUrl: 'http://127.0.0.1:' + port, insecure: false, runtimeToken: process.env.KUN_RUNTIME_TOKEN
  }));
});
`)
  const options = { dataDir: root, controlDir: join(root, 'control'), runtimeFlavor: 'production' as const,
    launch: { command: process.execPath, args: [script] }, timeoutMs: ready ? 10_000 : 300 }
  const host = new PersistentHost(options)
  cleanups.push(() => host.stop().catch(() => undefined))
  return { root, host, options }
}

describe('opt-in persistent host', () => {
  it('starts one real detached owner, preserves it across command instances, and stops the exact instance', async () => {
    const f = await fixture()
    const [a, b] = await Promise.all([f.host.start(), new PersistentHost(f.options).start()])
    expect(a.status).toBe('online')
    expect(a.pid).toBe(b.pid)
    expect(a.guiAttachSupported).toBe(false)
    expect((await new PersistentHost(f.options).status()).instanceId).toBe(a.instanceId)
    expect((await f.host.stop()).status).toBe('offline')
    expect((await f.host.status()).stoppedAt).toBeDefined()
  }, 20_000)

  it('preserves a foreign runtime and refuses startup or shutdown under a changed host identity', async () => {
    const f = await fixture(), running = await f.host.start()
    const record = join(f.root, 'persistent-host', 'owner.json')
    const original = await readFile(record, 'utf8')
    await writeFile(record, JSON.stringify({ ...JSON.parse(original), instanceId: 'foreign' }))
    expect((await f.host.status()).status).toBe('conflict')
    await expect(f.host.start()).rejects.toThrow('conflict')
    await expect(f.host.stop()).rejects.toThrow('identity')
    await writeFile(record, original)
    expect((await f.host.status()).pid).toBe(running.pid)
  }, 20_000)

  it('cleans up a failed startup and reports offline rather than healthy', async () => {
    const f = await fixture(false)
    await expect(f.host.start()).rejects.toThrow('did not become ready')
    const status = await f.host.status()
    expect(status.status).toBe('offline')
    expect(status.lastError).toContain('did not become ready')
    expect(status.stoppedAt).toBeDefined()
  }, 15_000)

  it('does not inherit a GUI/runtime process-stack owner or manager binding', () => {
    const env = persistentHostEnvironment({ KUN_APP_SESSION_OWNER: 'owner', KUN_APP_SESSION_RESERVATION: 'reservation',
      KUN_RUNTIME_CLIENT_OWNER_KIND: 'gui', KUN_MANAGER_TOKEN: 'secret', KUN_PROCESS_STACK_OWNER_PID: '9',
      KUN_MANAGER_CONTROL_DIR: '/control', KUN_MANAGER_SETTINGS_PATH: '/settings' })
    expect(env).toEqual({ KUN_MANAGER_CONTROL_DIR: '/control', KUN_MANAGER_SETTINGS_PATH: '/settings' })
  })

  it('documents ownership limits and rejects unsupported host controls without launching', async () => {
    let output = '', error = ''
    const io = { stdout: { write: (value: string) => { output += value } }, stderr: { write: (value: string) => { error += value } } }
    expect(await runHostCommand(['--help'], io)).toBe(0)
    expect(output).toContain('Close the GUI first')
    expect(output).toContain('No login service or remote push')
    expect(await runHostCommand(['restart'], io)).toBe(64)
    expect(error).toContain('unknown command')
  })
})
