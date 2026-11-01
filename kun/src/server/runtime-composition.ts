import {
  acquireRuntimeDataDirLease,
  type ServerRuntime
} from './runtime-factory-dependencies.js'
import { createRuntimeCore } from './runtime-composition-core.js'
import { createRuntimeModelComposition } from './runtime-composition-model.js'
import { createRuntimeServices } from './runtime-composition-services.js'
import { createRuntimeRegistry } from './runtime-composition-registry.js'
import { createRuntimeAgentComposition } from './runtime-composition-agent.js'
import { createRuntimeExtensionComposition } from './runtime-composition-extensions.js'
import { createRuntimeConfigController } from './runtime-composition-config.js'
import { createServerRuntimeComposition } from './runtime-composition-runtime.js'
import { AppConnectionsService } from '../services/app-connections-service.js'
import { McpCapabilityConfig } from '../contracts/capabilities-core.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { ownedProcessAdmissionClosed, resumeOwnedProcessAdmission } from '../process/owned-process.js'
import { recoverPendingMcpTransaction } from './runtime-mcp-transaction.js'
import { mcpDataLockPath, withMcpLock } from './runtime-mcp-lock.js'
import { kunConfigPathForDataDir } from '../config/kun-config.js'

export async function createKunServeRuntime(
  options: KunServeRuntimeOptions
): Promise<ServerRuntime> {
  // Embedders may explicitly create a new Runtime after fully shutting down
  // the previous one in the same Node process. The process layer refuses this
  // reset while any old child or guard is still alive.
  if (ownedProcessAdmissionClosed()) resumeOwnedProcessAdmission()
  const dataDirLease = options.serviceManager
    ? undefined
    : await acquireRuntimeDataDirLease(options.dataDir)
  const startupCleanups: Array<() => Promise<unknown>> = []
  try {
    // An interrupted cross-file MCP mutation must not start any server it left
    // enabled. Recovery takes the same lock as GUI synchronization, refuses an
    // unusable record or an unreadable/corrupt target, and only then rolls the
    // files back and clears the record.
    const recoveredMcp = await withMcpLock(mcpDataLockPath(options.dataDir), () =>
      recoverPendingMcpTransaction({
        dataDir: options.dataDir,
        configPath: options.configPath ?? kunConfigPathForDataDir(options.dataDir),
        sharedMcpConfigPath: options.sharedMcpConfigPath
      })
    )
    const effectiveOptions = disableRecoveredMcpServers(options, recoveredMcp.serverIds)
    const core = await createRuntimeCore(effectiveOptions, dataDirLease)
    const model = await createRuntimeModelComposition(core, {
      registerCleanup: (cleanup) => { startupCleanups.push(cleanup) }
    })
    const services = await createRuntimeServices(model)
    const registry = createRuntimeRegistry(services)
    const agent = await createRuntimeAgentComposition(registry)
    let runtime: ServerRuntime | undefined
    const extensions = await createRuntimeExtensionComposition(agent, () => runtime?.rooms)
    const config = createRuntimeConfigController(extensions)
    runtime = createServerRuntimeComposition(extensions, config)
    runtime.appConnections = new AppConnectionsService({
      ...(runtime.githubApp ? { github: runtime.githubApp } : {}),
      ...(runtime.gmail ? { gmail: runtime.gmail } : {}),
      ...(model.figma ? { figma: model.figma } : {}),
      mcp: {
        config: () => runtime!.mcpConfig?.() ?? McpCapabilityConfig.parse({}),
        oauth: () => runtime!.mcpOAuth?.() ?? [],
        setServer: (serverId, server) => runtime!.setMcpServer
          ? runtime!.setMcpServer(serverId, server)
          : Promise.resolve({ ok: false as const, code: 'invalid_config' as const, message: 'MCP configuration is unavailable' }),
        authorize: (serverId) => {
          if (!runtime!.authorizeMcpOAuth) throw new Error('MCP authorization is unavailable')
          return runtime!.authorizeMcpOAuth(serverId)
        },
        clear: (serverId) => runtime!.clearMcpOAuth
          ? runtime!.clearMcpOAuth(serverId)
          : Promise.resolve({ cleared: [] })
      }
    })
    return runtime
  } catch (error) {
    await Promise.allSettled(startupCleanups.reverse().map(async (cleanup) => cleanup()))
    await dataDirLease?.release().catch(() => undefined)
    throw error
  }
}

function disableRecoveredMcpServers(
  options: KunServeRuntimeOptions,
  serverIds: string[]
): KunServeRuntimeOptions {
  if (serverIds.length === 0 || !options.capabilities) return options
  const pending = new Set(serverIds)
  let changed = false
  const servers: NonNullable<KunServeRuntimeOptions['capabilities']>['mcp']['servers'] = {}
  for (const [id, server] of Object.entries(options.capabilities.mcp.servers)) {
    if (!pending.has(id) || server.enabled === false) {
      servers[id] = server
      continue
    }
    servers[id] = { ...server, enabled: false }
    changed = true
  }
  if (!changed) return options
  return {
    ...options,
    capabilities: { ...options.capabilities, mcp: { ...options.capabilities.mcp, servers } }
  }
}
