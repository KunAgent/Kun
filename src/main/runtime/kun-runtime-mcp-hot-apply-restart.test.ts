import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  normalizeAppSettings,
  resolveKunRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { KunConfigSchema } from '../../../kun/src/config/kun-config.js'
import { KunCapabilitiesConfig, McpServerConfig } from '../../../kun/src/contracts/capabilities.js'
import type { McpServersUpdatePayload } from '../../../kun/src/contracts/runtime-config.js'
import { createKunServeRuntime } from '../../../kun/src/server/runtime-factory.js'
import { configureManagerAtomicJsonClient } from '../../../kun/src/extensions/atomic-json.js'
import { buildManagedRuntimeHotApplyBody, syncGuiManagedKunConfig } from './kun-runtime-config-service'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/deepseek-gui-test-app',
    getPath: () => '/tmp/deepseek-gui-test-user-data'
  }
}))

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  configureManagerAtomicJsonClient(null)
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

const remote = (enabled: boolean) => McpServerConfig.parse({
  enabled, transport: 'streamable-http', url: 'https://127.0.0.1:1/mcp', trustScope: 'user'
})

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'kun-mcp-hot-apply-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'data')
  const shared = join(root, 'mcp.json')
  await mkdir(dataDir, { recursive: true })
  return { dataDir, shared }
}

function appSettings(): AppSettingsV1 {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return normalizeAppSettings({
    ...base,
    provider: defaultModelProviderSettings(),
    agents: { kun: defaultKunRuntimeSettings() }
  })
}

async function readConfigServers(dataDir: string): Promise<Record<string, any>> {
  const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as any
  return config.capabilities.mcp.servers
}

async function readSharedServers(shared: string): Promise<Record<string, any>> {
  return (JSON.parse(await readFile(shared, 'utf8')) as { servers: Record<string, any> }).servers
}

async function startRuntime(dataDir: string, shared: string, capabilities: KunCapabilitiesConfig) {
  const runtime = await createKunServeRuntime({
    host: '127.0.0.1', port: 0, dataDir, sharedMcpConfigPath: shared,
    runtimeToken: 'test-token', apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'test',
    approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
    capabilities
  })
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await runtime.shutdown?.()
  }
  cleanup.push(close)
  return { runtime, close }
}

/** Direct `kun serve` restart path: capabilities come from config.json. */
async function restartFromDisk(dataDir: string, shared: string) {
  const parsed = KunConfigSchema.parse(
    JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
  )
  return startRuntime(dataDir, shared, parsed.capabilities ?? KunCapabilitiesConfig.parse({}))
}

it('keeps a Runtime disable across a rejected stale apply and both restarts', async () => {
  const { dataDir, shared } = await workspace()
  const settings = appSettings()
  const runtimeSettings = resolveKunRuntimeSettings(settings)

  await writeFile(join(dataDir, 'config.json'), JSON.stringify({
    capabilities: { mcp: { servers: { app: remote(true) } } }
  }), 'utf8')
  await writeFile(shared, JSON.stringify({ servers: { app: remote(true) } }), 'utf8')
  // GUI startup sync materializes the managed host entries.
  await syncGuiManagedKunConfig(dataDir, runtimeSettings, { mcpConfigPath: shared })

  const first = await restartFromDisk(dataDir, shared)
  expect(first.runtime.mcpConfig!().servers.app.enabled).toBe(true)

  // The user adds a server; the GUI sync writes it and reports a replacement
  // whose base is the pre-sync server set.
  await writeFile(shared, JSON.stringify({
    servers: { app: remote(true), extra: remote(true) }
  }), 'utf8')
  let decision: McpServersUpdatePayload | undefined
  const config = await syncGuiManagedKunConfig(dataDir, runtimeSettings, {
    mcpConfigPath: shared,
    onMcpServersUpdate: (update) => { decision = update }
  })
  expect(decision).toMatchObject({ mode: 'replace', base: { app: { enabled: true } } })

  // Barrier: the Runtime completes a disable after the sync returned and before
  // the stale hot apply is sent.
  expect((await first.runtime.setMcpServer!('app', { ...remote(true), enabled: false })).ok).toBe(true)
  expect((await readConfigServers(dataDir)).app.enabled).toBe(false)

  const stale = await first.runtime.applyConfig!(
    buildManagedRuntimeHotApplyBody(settings, config, null, decision)
  )
  expect(stale.ok).toBe(false)
  expect(stale.ok ? '' : stale.message).toMatch(/changed in the Runtime/)

  // Memory and both files keep the disable; the per-id write kept the new server.
  expect(first.runtime.mcpConfig!().servers.app.enabled).toBe(false)
  expect((await readConfigServers(dataDir)).app.enabled).toBe(false)
  expect((await readConfigServers(dataDir)).extra.enabled).toBe(true)
  expect((await readSharedServers(shared)).app.enabled).toBe(false)
  expect((await readSharedServers(shared)).extra.enabled).toBe(true)
  // The rejected apply must not leave a recovery transaction behind: the files
  // already agree and a restart must not roll anything back.
  expect(existsSync(join(dataDir, 'mcp-transaction.json'))).toBe(false)

  // A GUI sync that runs after the disable reads the disabled files and keeps
  // the Runtime's server set untouched.
  let afterDisableDecision: McpServersUpdatePayload | undefined
  await syncGuiManagedKunConfig(dataDir, runtimeSettings, {
    mcpConfigPath: shared,
    onMcpServersUpdate: (update) => { afterDisableDecision = update }
  })
  expect(afterDisableDecision).toEqual({ mode: 'preserve' })
  expect((await readConfigServers(dataDir)).app.enabled).toBe(false)

  // Direct Runtime restart reads config.json only.
  await first.close()
  const restarted = await restartFromDisk(dataDir, shared)
  expect(restarted.runtime.mcpConfig!().servers.app.enabled).toBe(false)
  // The user's new server is not lost by the conflict: it is in config.json and
  // starts enabled on the next launch.
  expect(restarted.runtime.mcpConfig!().servers.extra.enabled).toBe(true)

  // GUI restart: the next sync must not resurrect the disabled server.
  let restartDecision: McpServersUpdatePayload | undefined
  const restartedConfig = await syncGuiManagedKunConfig(dataDir, runtimeSettings, {
    mcpConfigPath: shared,
    onMcpServersUpdate: (update) => { restartDecision = update }
  })
  expect(restartDecision).toEqual({ mode: 'preserve' })
  expect((await readConfigServers(dataDir)).app.enabled).toBe(false)
  expect((await readSharedServers(shared)).app.enabled).toBe(false)
  // The GUI's own hot apply of that preserve body keeps the Runtime disabled.
  expect((await restarted.runtime.applyConfig!(
    buildManagedRuntimeHotApplyBody(settings, restartedConfig, null, restartDecision)
  )).ok).toBe(true)
  expect(restarted.runtime.mcpConfig!().servers.app.enabled).toBe(false)
})

it('keeps a Runtime disable across an accepted stale apply and both restarts', async () => {
  const { dataDir, shared } = await workspace()
  const settings = appSettings()
  const runtimeSettings = resolveKunRuntimeSettings(settings)

  await writeFile(join(dataDir, 'config.json'), JSON.stringify({
    capabilities: { mcp: { servers: { app: remote(true) } } }
  }), 'utf8')
  await writeFile(shared, JSON.stringify({ servers: { app: remote(true) } }), 'utf8')
  await syncGuiManagedKunConfig(dataDir, runtimeSettings, { mcpConfigPath: shared })
  const first = await restartFromDisk(dataDir, shared)

  // No server change in this sync: the hot apply carries `preserve`.
  let decision: McpServersUpdatePayload | undefined
  const config = await syncGuiManagedKunConfig(dataDir, runtimeSettings, {
    mcpConfigPath: shared,
    onMcpServersUpdate: (update) => { decision = update }
  })
  expect(decision).toEqual({ mode: 'preserve' })

  expect((await first.runtime.setMcpServer!('app', { ...remote(true), enabled: false })).ok).toBe(true)
  const stale = await first.runtime.applyConfig!(
    buildManagedRuntimeHotApplyBody(settings, config, null, decision)
  )
  expect(stale.ok).toBe(true)
  expect(first.runtime.mcpConfig!().servers.app.enabled).toBe(false)
  expect((await readConfigServers(dataDir)).app.enabled).toBe(false)
  expect((await readSharedServers(shared)).app.enabled).toBe(false)

  await first.close()
  const restarted = await restartFromDisk(dataDir, shared)
  expect(restarted.runtime.mcpConfig!().servers.app.enabled).toBe(false)

  let restartDecision: McpServersUpdatePayload | undefined
  await syncGuiManagedKunConfig(dataDir, runtimeSettings, {
    mcpConfigPath: shared,
    onMcpServersUpdate: (update) => { restartDecision = update }
  })
  expect(restartDecision).toEqual({ mode: 'preserve' })
  expect((await readConfigServers(dataDir)).app.enabled).toBe(false)
  expect((await readSharedServers(shared)).app.enabled).toBe(false)
})
