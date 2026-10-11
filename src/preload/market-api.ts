import { ipcRenderer } from 'electron'
import type { KunGuiMarketApi } from '../shared/market/kun-gui-api-market'

/**
 * Skill / MCP market bridge methods. Spread into the main `kunGui` api object
 * in `index.ts` to keep that file under the line limit.
 */
export const marketApi: KunGuiMarketApi = {
  marketListSources: () => ipcRenderer.invoke('market:list-sources'),
  marketGetCatalog: (request) => ipcRenderer.invoke('market:get-catalog', request),
  marketInstallSkill: (request) => ipcRenderer.invoke('market:install-skill', request),
  marketPlanMcpInstall: (request) => ipcRenderer.invoke('market:plan-mcp-install', request)
}
