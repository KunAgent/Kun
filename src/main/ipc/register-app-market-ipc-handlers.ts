import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { MarketService } from '../services/market/market-service'
import { marketFetch } from '../services/market/market-http'
import { planMarketMcpInstallFromCatalog } from '../services/market/market-mcp-plan'
import { installMarketSkill } from '../services/market/market-skill-installer'
import { youdaoMarketSource } from '../services/market/youdao-market-source'
import {
  marketCatalogPayloadSchema,
  marketInstallSkillPayloadSchema,
  marketMcpInstallPayloadSchema
} from './app-ipc-schemas'
import { parseIpcPayload } from './app-ipc-handler-utils'

/**
 * Remote Skill / MCP markets. Add a market by appending its source here; the
 * catalog cache, install flow and marketplace UI are source-agnostic.
 */
export function registerAppMarketIpcHandlers(
  options: { service?: MarketService } = {}
): MarketService {
  const service = options.service ?? new MarketService({
    sources: [youdaoMarketSource],
    cacheDir: join(app.getPath('userData'), 'market-cache'),
    fetcher: marketFetch
  })

  ipcMain.handle('market:list-sources', () => service.listSources())

  ipcMain.handle('market:get-catalog', async (_, payload: unknown) => {
    const request = parseIpcPayload('market:get-catalog', marketCatalogPayloadSchema, payload)
    return service.getCatalog(request.sourceId, request.mode ?? 'auto')
  })

  ipcMain.handle('market:install-skill', async (_, payload: unknown) => {
    const request = parseIpcPayload('market:install-skill', marketInstallSkillPayloadSchema, payload)
    return installMarketSkill(request, { service, fetcher: marketFetch })
  })

  ipcMain.handle('market:plan-mcp-install', async (_, payload: unknown) => {
    const request = parseIpcPayload('market:plan-mcp-install', marketMcpInstallPayloadSchema, payload)
    return planMarketMcpInstallFromCatalog(request, { service, fetcher: marketFetch })
  })

  return service
}
