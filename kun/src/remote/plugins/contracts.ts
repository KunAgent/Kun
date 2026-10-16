import { z } from 'zod'
const PluginId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/)
export const PluginCatalogParams = z.object({ cursor: PluginId.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict()
export const PluginSetEnabledParams = z.object({ pluginId: PluginId, expectedRevision: z.string().regex(/^plugin-v1:[a-f0-9]{64}$/), enabled: z.boolean() }).strict()
export const PluginViewParams = z.object({ pluginId: PluginId, contributionId: z.string().min(1).max(128) }).strict()
export const PluginParamSchemas = { 'plugin.setEnabled': PluginSetEnabledParams, 'plugin.catalog': PluginCatalogParams, 'plugin.view': PluginViewParams } as const
