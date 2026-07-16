import type { KunExtension, LoopHookBus } from '../types.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { MoaConfigAdapter } from '../../moa/adapters/moa-config.js'
import { MoaDispatchModelClient } from '../../moa/adapters/moa-model-client.js'
import { createMoaRoutingHook } from '../../moa/routing/moa-routing.js'
import type { MultiProviderModelClient } from '../../adapters/model/multi-provider-model-client.js'
import type { Router } from '../../server/router.js'
import { authenticated } from '../auth.js'

/**
 * MoA Feature Extension
 *
 * Registers:
 * - MoA model clients (one per preset) with MultiProviderModelClient
 * - MoA routing hook (decides when to use MoA vs single model)
 *
 * Based on latest research (2025-2026):
 * - Together AI foundational paper (arXiv:2406.04692)
 * - Attention-MoA, MMoA, Pyramid MoA advances
 * - Parallel proposer execution + graceful degradation
 */

// Module-level references for hook registration
let moaConfigAdapter: MoaConfigAdapter | undefined

const moaExtension: KunExtension = {
  id: 'moa',

  registerRoutes(router: Router, runtime: ServerRuntime): void {
    const services = runtime.extensions?.moa as { moa?: MoaConfigAdapter } | undefined
    const adapter = services?.moa

    router.add('GET', '/v1/moa/presets', authenticated(async () => {
      if (!adapter) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'MoA service unavailable' })
        }
      }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          presets: adapter.getPresets().map((preset) => ({
            ...preset,
            isCustom: adapter.isCustomPreset(preset.id)
          })),
          models: adapter.getModelCatalogEntries(),
          defaultPresetId: adapter.getDefaultPreset()?.id
        })
      }
    }, runtime))

    router.add('POST', '/v1/moa/presets', authenticated(async (request) => {
      if (!adapter) {
        return { status: 503, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'MoA service unavailable' }) }
      }
      try {
        const preset = await adapter.savePreset(JSON.parse(await request.text()))
        return {
          status: 201,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset, modelId: `moa:${preset.id}`, valid: true })
        }
      } catch (error) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
        }
      }
    }, runtime))

    router.add('GET', '/v1/moa/presets/:id', authenticated(async (_request, context) => {
      const preset = adapter?.getPreset(context.params.id)
      return preset
        ? {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ preset })
          }
        : {
            status: adapter ? 404 : 503,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: adapter ? 'MoA preset not found' : 'MoA service unavailable' })
          }
    }, runtime))

    router.add('DELETE', '/v1/moa/presets/:id', authenticated(async (_request, context) => {
      if (!adapter) {
        return { status: 503, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'MoA service unavailable' }) }
      }
      const deleted = await adapter.deletePreset(context.params.id)
      return {
        status: deleted ? 200 : 409,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(deleted ? { deleted: true } : { error: 'Built-in or unknown preset cannot be deleted' })
      }
    }, runtime))
  },

  async initializeServices(featureConfig: unknown, runtime: ServerRuntime): Promise<Record<string, unknown>> {
    // Parse MoA config
    const configAdapter = new MoaConfigAdapter({
      rawConfig: featureConfig,
      dataDir: runtime.info?.().dataDir
    })
    await configAdapter.initialize()

    // Disable any preset whose referenced providers are not configured, so a
    // preset never silently misroutes to the default provider. The default
    // provider (bare modelId refs) is always available.
    const configuredProviders = new Set<string>(['default'])
    const runtimeProviders = (runtime as unknown as {
      modelClient?: { registeredProviderIds?: () => string[] }
    }).modelClient?.registeredProviderIds?.() ?? []
    for (const id of runtimeProviders) configuredProviders.add(id)
    const disabled = configAdapter.validateProviders(configuredProviders)
    for (const entry of disabled) {
      console.warn(
        `[MoA] Preset '${entry.presetId}' disabled: missing provider(s) ${entry.missing.join(', ')}. ` +
        `Configure these providers/accounts, then re-enable the preset.`
      )
    }

    moaConfigAdapter = configAdapter

    // Return config adapter for other services (e.g., GUI to list presets)
    return { moa: configAdapter }
  },

  registerModelClients(registry: unknown): void {
    if (!moaConfigAdapter) {
      // MoA service not initialized, skip registration
      return
    }

    // Cast registry to MultiProviderModelClient
    const multiProviderClient = registry as MultiProviderModelClient

    // Register a SINGLE dispatcher under providerId='moa'. It resolves the
    // preset from request.model ('moa-{presetId}') at stream time, so adding
    // presets never collides on the provider id and config hot-reload is a
    // no-op for registration (the dispatcher reads the live config adapter).
    if (multiProviderClient.registeredProviderIds().includes('moa')) {
      multiProviderClient.unregister('moa')
    }
    multiProviderClient.register('moa', new MoaDispatchModelClient({
      configAdapter: moaConfigAdapter,
      multiProviderClient
    }))
  },

  contributeModels() {
    return moaConfigAdapter?.getModelCatalogEntries() ?? []
  },

  registerLoopHooks(bus: LoopHookBus): void {
    if (!moaConfigAdapter) {
      // MoA service not initialized, skip hook registration
      return
    }

    // Register routing hook to set providerId='moa' when thread uses MoA
    const routingHook = createMoaRoutingHook({ configAdapter: moaConfigAdapter })
    bus.on('beforeModelRequest', routingHook)
  }
}

export default moaExtension
