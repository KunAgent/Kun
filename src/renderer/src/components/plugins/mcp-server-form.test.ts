import { describe, expect, it } from 'vitest'
import type { MarketMcpInstallPlan } from '@shared/market/market-types'
import { auditMcpConfigSupplyChain } from '../plugin-marketplace-config'
import {
  applyMcpServerForm,
  formFromPlan,
  isSecretField,
  missingEnvForServer,
  missingEnvKeys,
  readMcpServerForm,
  removeMcpServer,
  requiredEnvKeys,
  serverToForm,
  validateMcpServerForm
} from './mcp-server-form'

const CONFIG = JSON.stringify({
  model: 'keep-me',
  servers: {
    tavily: {
      enabled: false,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'tavily-mcp@0.2.22'],
      env: { TAVILY_API_KEY: '' },
      trustScope: 'user',
      timeoutMs: 30000
    },
    gmail: {
      enabled: true,
      transport: 'streamable-http',
      url: 'https://gmailmcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer old' },
      trustScope: 'user'
    }
  }
})

const PLAN: MarketMcpInstallPlan = {
  transport: 'stdio',
  id: 'gitlab',
  command: 'npx',
  args: ['-y', '@zereight/mcp-gitlab@2.1.30'],
  requiredEnvKeys: ['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_PERMISSION_MODE'],
  optionalEnvKeys: ['GITLAB_API_URL']
}

describe('mcp server form', () => {
  it('reads stdio and remote servers into forms', () => {
    expect(readMcpServerForm(CONFIG, 'tavily')).toMatchObject({
      transport: 'stdio', command: 'npx', args: ['-y', 'tavily-mcp@0.2.22'],
      env: [{ key: 'TAVILY_API_KEY', value: '' }], timeoutSec: 30, enabled: false
    })
    expect(readMcpServerForm(CONFIG, 'gmail')).toMatchObject({
      transport: 'remote', remoteTransport: 'streamable-http', url: 'https://gmailmcp.googleapis.com/mcp/v1',
      headers: [{ key: 'Authorization', value: 'Bearer old' }], enabled: true
    })
    expect(readMcpServerForm(CONFIG, 'missing')).toBeNull()
  })

  it('treats empty placeholders and declared keys as required, and reports what is missing', () => {
    const server = JSON.parse(CONFIG).servers.tavily
    expect(requiredEnvKeys(server, [])).toEqual(['TAVILY_API_KEY'])
    expect(missingEnvForServer(server, [])).toEqual(['TAVILY_API_KEY'])
    expect(missingEnvForServer({ ...server, env: { TAVILY_API_KEY: 'tvly-1' } }, ['TAVILY_API_KEY'])).toEqual([])
    expect(missingEnvForServer(JSON.parse(CONFIG).servers.gmail, ['ANY'])).toEqual([])
    expect(missingEnvKeys([{ key: 'A', value: '  ' }], ['A', 'B'])).toEqual(['A', 'B'])
  })

  it('fills a key in place and keeps fields the sheet does not edit', () => {
    const form = { ...readMcpServerForm(CONFIG, 'tavily')!, env: [{ key: 'TAVILY_API_KEY', value: 'tvly-secret' }], enabled: true }
    const next = JSON.parse(applyMcpServerForm(CONFIG, form, { requiredKeys: ['TAVILY_API_KEY'] }))
    expect(next.model).toBe('keep-me')
    expect(next.servers.tavily).toMatchObject({ enabled: true, env: { TAVILY_API_KEY: 'tvly-secret' }, trustScope: 'user', timeoutMs: 30000 })
    expect(next.servers.gmail.headers).toEqual({ Authorization: 'Bearer old' })
  })

  it('keeps an empty required key as the fill-me marker but drops empty optional ones', () => {
    const form = formFromPlan(PLAN)
    expect(form.env.map((row) => row.key)).toEqual(['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_PERMISSION_MODE', 'GITLAB_API_URL'])
    const next = JSON.parse(applyMcpServerForm('', { ...form, enabled: false }, { requiredKeys: PLAN.requiredEnvKeys }))
    expect(next.servers.gitlab.env).toEqual({ GITLAB_PERSONAL_ACCESS_TOKEN: '', GITLAB_PERMISSION_MODE: '' })
    expect(next.servers.gitlab.enabled).toBe(false)
    expect(auditMcpConfigSupplyChain(next).ok).toBe(true)
  })

  it('writes into the nested capabilities.mcp.servers layout when that is what the file uses', () => {
    const nested = JSON.stringify({ capabilities: { mcp: { enabled: true, servers: { a: { command: 'npx', args: ['-y', 'a@1.0.0'] } } } } })
    const form = { ...serverToForm('a', { command: 'npx', args: ['-y', 'a@1.0.0'] }), env: [{ key: 'K', value: 'v' }] }
    const next = JSON.parse(applyMcpServerForm(nested, form))
    expect(next.capabilities.mcp.enabled).toBe(true)
    expect(next.capabilities.mcp.servers.a.env).toEqual({ K: 'v' })
    expect(next.servers).toBeUndefined()
  })

  it('updates remote headers and removes servers', () => {
    const form = { ...readMcpServerForm(CONFIG, 'gmail')!, headers: [{ key: 'Authorization', value: 'Bearer new' }] }
    const next = JSON.parse(applyMcpServerForm(CONFIG, form))
    expect(next.servers.gmail).toMatchObject({ transport: 'streamable-http', headers: { Authorization: 'Bearer new' } })
    expect(next.servers.gmail.command).toBeUndefined()
    const removed = JSON.parse(removeMcpServer(CONFIG, 'tavily'))
    expect(Object.keys(removed.servers)).toEqual(['gmail'])
    expect(() => removeMcpServer(CONFIG, 'nope')).toThrow('does not exist')
  })

  it('validates commands, URLs and env names', () => {
    const base = readMcpServerForm(CONFIG, 'tavily')!
    expect(validateMcpServerForm({ ...base, command: ' ' })).toEqual([{ code: 'command-required' }])
    expect(validateMcpServerForm({ ...readMcpServerForm(CONFIG, 'gmail')!, url: 'http://x' })).toEqual([{ code: 'url-https' }])
    expect(validateMcpServerForm({ ...base, env: [{ key: '1BAD', value: 'x' }, { key: 'OK', value: '' }, { key: 'OK', value: '' }] }))
      .toEqual([{ code: 'env-key-invalid', key: '1BAD' }, { code: 'env-key-duplicate', key: 'OK' }])
    expect(validateMcpServerForm({ ...base, env: [{ key: '', value: '' }] })).toEqual([])
  })

  it('masks secret-looking names', () => {
    expect(isSecretField('TAVILY_API_KEY')).toBe(true)
    expect(isSecretField('OPENAPI_MCP_HEADERS')).toBe(true)
    expect(isSecretField('Authorization')).toBe(true)
    expect(isSecretField('GITLAB_API_URL')).toBe(false)
  })
})
