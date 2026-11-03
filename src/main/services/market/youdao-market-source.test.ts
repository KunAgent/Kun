import { describe, expect, it } from 'vitest'
import { isAllowedDownloadUrl } from './market-source'
import {
  YOUDAO_MCP_MARKETPLACE_URL,
  YOUDAO_SKILL_STORE_URL,
  parseYoudaoMcpServers,
  parseYoudaoSkills,
  youdaoMarketSource
} from './youdao-market-source'

const SKILL_STORE = {
  code: 0,
  data: {
    value: {
      // Bundled with the LobsterAI app and carries no download URL: not installable.
      localSkill: [{ id: 'xlsx', name: 'xlsx', displayName: { en: 'Excel', zh: '表格处理' } }],
      marketTags: [
        { id: 'utility', en: 'Productivity', zh: '效率工具' },
        { id: 'all', en: 'All', zh: '全部' }
      ],
      marketplace: [
        {
          id: 'hr-recruitment',
          name: 'hr-recruitment',
          displayName: { en: 'HR Recruitment', zh: '招聘助手' },
          description: { en: 'Screen resumes', zh: '筛选简历' },
          version: '1.2.5',
          url: 'https://ydhardwarecommon.nosdn.127.net/307ea.zip',
          source: { author: 'LobsterAI', from: 'youdao', url: 'https://lobsterai.youdao.com' },
          tags: ['utility']
        },
        { id: '../escape', name: 'x', url: 'https://ydhardwarecommon.nosdn.127.net/x.zip' },
        { id: 'No-Download', name: 'No-Download' },
        { id: 'hr-recruitment', name: 'duplicate', url: 'https://ydhardwarecommon.nosdn.127.net/dup.zip' },
        { id: 'plain', displayName: { zh: '仅中文' }, url: 'https://ydschool-video.nosdn.127.net/plain.zip' }
      ]
    }
  }
}

const MCP_MARKET = {
  code: 0,
  data: {
    value: {
      categories: [
        { id: 'all', name_en: 'All', name_zh: '全部' },
        { id: 'search', name_en: 'Search', name_zh: '搜索' }
      ],
      servers: [
        {
          id: 'tavily',
          name: 'Tavily',
          name_zh: 'Tavily 搜索',
          description_en: 'Web search',
          description_zh: '网页搜索',
          category: 'search',
          transportType: 'stdio',
          command: 'npx',
          defaultArgs: ['-y', 'tavily-mcp@latest'],
          requiredEnvKeys: ['TAVILY_API_KEY', 'bad key'],
          optionalEnvKeys: ['TAVILY_REGION']
        },
        { id: 'sse-only', name: 'SSE', transportType: 'sse', command: 'https://example.com/sse' },
        { id: 'insecure', name: 'Insecure', transportType: 'http', command: 'http://example.com/mcp' },
        { id: 'remote', name: 'Remote', transportType: 'http', command: 'https://example.com/mcp' }
      ]
    }
  }
}

function fakeFetcher(responses: Record<string, unknown>) {
  const calls: string[] = []
  const fetcher = async (url: string): Promise<Response> => {
    calls.push(url)
    if (!(url in responses)) return new Response('nope', { status: 404 })
    return new Response(JSON.stringify(responses[url]), { status: 200 })
  }
  return { fetcher, calls }
}

describe('youdao market source', () => {
  it('normalizes the skill store and skips unusable entries', () => {
    const skills = parseYoudaoSkills(SKILL_STORE.data.value.marketplace)
    expect(skills.map((skill) => skill.id)).toEqual(['hr-recruitment', 'plain'])
    expect(skills[0]).toMatchObject({
      sourceId: 'youdao',
      name: { en: 'HR Recruitment', zh: '招聘助手' },
      version: '1.2.5',
      tags: ['utility'],
      origin: { author: 'LobsterAI', from: 'youdao' }
    })
    // A missing English string falls back to the Chinese copy instead of going blank.
    expect(skills[1]?.name).toEqual({ en: 'plain', zh: '仅中文' })
  })

  it('maps stdio and https remote MCP servers and drops everything else', () => {
    const servers = parseYoudaoMcpServers(MCP_MARKET.data.value.servers)
    expect(servers.map((server) => [server.id, server.transport])).toEqual([
      ['tavily', 'stdio'],
      ['remote', 'remote']
    ])
    expect(servers[0]).toMatchObject({
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      requiredEnvKeys: ['TAVILY_API_KEY'],
      optionalEnvKeys: ['TAVILY_REGION'],
      name: { en: 'Tavily', zh: 'Tavily 搜索' }
    })
  })

  it('fetches both endpoints and builds a catalog without the synthetic "all" taxa', async () => {
    const { fetcher, calls } = fakeFetcher({
      [YOUDAO_SKILL_STORE_URL]: SKILL_STORE,
      [YOUDAO_MCP_MARKETPLACE_URL]: MCP_MARKET
    })
    const catalog = await youdaoMarketSource.fetchCatalog(fetcher, new AbortController().signal)
    expect(calls.sort()).toEqual([YOUDAO_MCP_MARKETPLACE_URL, YOUDAO_SKILL_STORE_URL].sort())
    expect(catalog.skills).toHaveLength(2)
    expect(catalog.mcpServers).toHaveLength(2)
    expect(catalog.skillTags.map((tag) => tag.id)).toEqual(['utility'])
    expect(catalog.mcpCategories.map((category) => category.id)).toEqual(['search'])
  })

  it('rejects an HTTP error and a payload without data.value', async () => {
    const down = async (): Promise<Response> => new Response('boom', { status: 503 })
    await expect(youdaoMarketSource.fetchCatalog(down, new AbortController().signal)).rejects.toThrow('HTTP 503')
    const bare = async (): Promise<Response> => new Response(JSON.stringify({ data: {} }), { status: 200 })
    await expect(youdaoMarketSource.fetchCatalog(bare, new AbortController().signal)).rejects.toThrow('data.value')
  })
})

describe('isAllowedDownloadUrl', () => {
  const hosts = youdaoMarketSource.allowedDownloadHosts
  it('accepts Youdao CDN archives over https only', () => {
    expect(isAllowedDownloadUrl('https://ydschool-video.nosdn.127.net/a.zip', hosts)).toBe(true)
    expect(isAllowedDownloadUrl('https://lobsterai.youdao.com/x.zip', hosts)).toBe(true)
    expect(isAllowedDownloadUrl('http://ydschool-video.nosdn.127.net/a.zip', hosts)).toBe(false)
  })

  it('rejects look-alike and unrelated hosts', () => {
    expect(isAllowedDownloadUrl('https://evil127.net/a.zip', hosts)).toBe(false)
    expect(isAllowedDownloadUrl('https://127.net.evil.com/a.zip', hosts)).toBe(false)
    expect(isAllowedDownloadUrl('https://example.com/a.zip', hosts)).toBe(false)
    expect(isAllowedDownloadUrl('not a url', hosts)).toBe(false)
  })
})
