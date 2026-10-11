import type {
  MarketLocalizedText,
  MarketMcpEntry,
  MarketSkillEntry,
  MarketTaxon
} from '../../../shared/market/market-types'
import {
  asString,
  asStringList,
  isRecord,
  isSafeMarketId,
  type MarketFetch,
  type MarketSource,
  type MarketSourceCatalog
} from './market-source'

export const YOUDAO_MARKET_SOURCE_ID = 'youdao'

const YOUDAO_STORE_BASE =
  'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod'
export const YOUDAO_SKILL_STORE_URL = `${YOUDAO_STORE_BASE}/skill-store`
export const YOUDAO_MCP_MARKETPLACE_URL = `${YOUDAO_STORE_BASE}/mcp-marketplace`

const MAX_CATALOG_BYTES = 5 * 1024 * 1024
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

export const youdaoMarketSource: MarketSource = {
  info: {
    id: YOUDAO_MARKET_SOURCE_ID,
    label: { en: 'Youdao Market', zh: '有道市场' },
    homepage: 'https://lobsterai.youdao.com'
  },
  // Skill archives are served from Youdao's NetEase CDN (`*.nosdn.127.net`).
  allowedDownloadHosts: ['.127.net', '.youdao.com'],
  async fetchCatalog(fetcher, signal): Promise<MarketSourceCatalog> {
    const [skillStore, mcpMarketplace] = await Promise.all([
      fetchEnvelope(fetcher, YOUDAO_SKILL_STORE_URL, signal),
      fetchEnvelope(fetcher, YOUDAO_MCP_MARKETPLACE_URL, signal)
    ])
    return {
      skills: parseYoudaoSkills(skillStore.marketplace),
      skillTags: parseYoudaoTaxa(skillStore.marketTags, 'en', 'zh'),
      mcpServers: parseYoudaoMcpServers(mcpMarketplace.servers),
      mcpCategories: parseYoudaoTaxa(mcpMarketplace.categories, 'name_en', 'name_zh')
    }
  }
}

/** Both endpoints answer `{ data: { value: {...} }, code, msg }`. */
async function fetchEnvelope(
  fetcher: MarketFetch,
  url: string,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Youdao market responded HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > MAX_CATALOG_BYTES) throw new Error('Youdao market response is too large.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Youdao market returned invalid JSON.')
  }
  const value = isRecord(parsed) && isRecord(parsed.data) ? parsed.data.value : undefined
  if (!isRecord(value)) throw new Error('Youdao market response is missing data.value.')
  return value
}

function localized(raw: unknown, fallback = ''): MarketLocalizedText {
  const record = isRecord(raw) ? raw : {}
  const en = asString(record.en) || fallback
  const zh = asString(record.zh) || en
  return { ...(en ? { en } : {}), ...(zh ? { zh } : {}) }
}

export function parseYoudaoSkills(raw: unknown): MarketSkillEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const skills: MarketSkillEntry[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = asString(item.id) || asString(item.name)
    const downloadUrl = asString(item.url)
    if (!isSafeMarketId(id) || seen.has(id) || !downloadUrl) continue
    seen.add(id)
    const origin = isRecord(item.source) ? item.source : {}
    const author = asString(origin.author)
    const from = asString(origin.from)
    const originUrl = asString(origin.url)
    const version = asString(item.version)
    skills.push({
      sourceId: YOUDAO_MARKET_SOURCE_ID,
      id,
      name: localized(item.displayName, asString(item.name) || id),
      description: localized(item.description),
      ...(version ? { version } : {}),
      tags: asStringList(item.tags),
      downloadUrl,
      ...(author || from || originUrl
        ? {
            origin: {
              ...(author ? { author } : {}),
              ...(from ? { from } : {}),
              ...(originUrl ? { url: originUrl } : {})
            }
          }
        : {})
    })
  }
  return skills
}

export function parseYoudaoMcpServers(raw: unknown): MarketMcpEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const servers: MarketMcpEntry[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = asString(item.id)
    const command = asString(item.command)
    if (!isSafeMarketId(id) || seen.has(id) || !command) continue
    const transportType = asString(item.transportType).toLowerCase()
    const base = {
      sourceId: YOUDAO_MARKET_SOURCE_ID,
      id,
      name: {
        en: asString(item.name) || id,
        zh: asString(item.name_zh) || asString(item.name) || id
      },
      description: localized({ en: item.description_en, zh: item.description_zh }),
      ...(asString(item.category) ? { category: asString(item.category) } : {}),
      ...(asString(item.icon) ? { icon: asString(item.icon) } : {}),
      requiredEnvKeys: asStringList(item.requiredEnvKeys).filter((key) => ENV_KEY.test(key)),
      optionalEnvKeys: asStringList(item.optionalEnvKeys).filter((key) => ENV_KEY.test(key))
    }
    if (transportType === 'stdio') {
      seen.add(id)
      servers.push({ ...base, transport: 'stdio', command, args: asStringList(item.defaultArgs) })
    } else if (transportType === 'http' || transportType === 'streamable-http') {
      // Remote entries carry the endpoint in `command`; only TLS endpoints qualify.
      if (!command.startsWith('https://')) continue
      seen.add(id)
      servers.push({ ...base, transport: 'remote', url: command })
    }
  }
  return servers
}

function parseYoudaoTaxa(raw: unknown, enKey: string, zhKey: string): MarketTaxon[] {
  if (!Array.isArray(raw)) return []
  const taxa: MarketTaxon[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = asString(item.id)
    if (!id || id === 'all') continue
    taxa.push({ id, name: localized({ en: item[enKey], zh: item[zhKey] }, id) })
  }
  return taxa
}
