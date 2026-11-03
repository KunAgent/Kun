import type {
  MarketCatalogMode,
  MarketCatalogResult,
  MarketInstallSkillRequest,
  MarketInstallSkillResult,
  MarketMcpInstallRequest,
  MarketMcpInstallResult,
  MarketSourceInfo
} from './market-types'

/** Skill / MCP market bridge methods exposed on `window.kunGui`. */
export type KunGuiMarketApi = {
  marketListSources: () => Promise<MarketSourceInfo[]>
  marketGetCatalog: (request: {
    sourceId: string
    mode?: MarketCatalogMode
  }) => Promise<MarketCatalogResult>
  marketInstallSkill: (request: MarketInstallSkillRequest) => Promise<MarketInstallSkillResult>
  marketPlanMcpInstall: (request: MarketMcpInstallRequest) => Promise<MarketMcpInstallResult>
}
