import { describe, expect, it } from 'vitest'
import { classifyProviderQuotaProbe } from './provider-quota-service-core.js'
import { scopedQuotaFetch } from './provider-quota-security.js'
import { jsonPointerPath, parseAiHubMixBalance, parseCustomBalance, parseNewApiKeyBalance, parseSiliconFlowBalance, parseStepFunBalance } from './provider-quota-balance-parsers.js'
import { runProbe } from './provider-quota-service-probe.js'

describe('balance parsers', () => {
  it('reads SiliconFlow and StepFun balances in their currency', () => {
    expect(parseSiliconFlowBalance({ code: 20000, status: true, data: { balance: '1.5', chargeBalance: '10', totalBalance: '11.5' } }, 'CNY'))
      .toEqual([{ id: 'total-balance', label: 'Total balance', unit: 'CNY', remaining: 11.5 },
        { id: 'charge-balance', label: 'Paid balance', unit: 'CNY', remaining: 10 },
        { id: 'gift-balance', label: 'Gift balance', unit: 'CNY', remaining: 1.5 }])
    expect(parseStepFunBalance({ object: 'account', balance: 26, total_cash_balance: 0, total_voucher_balance: 26 }, 'CNY')[0])
      .toEqual({ id: 'balance', label: 'Balance', unit: 'CNY', remaining: 26 })
    expect(() => parseSiliconFlowBalance({ status: false, message: 'invalid key' }, 'CNY')).toThrow('invalid key')
  })
  it('explains an unlimited AiHubMix key and converts new-api units to dollars', () => {
    expect(parseAiHubMixBalance({ object: 'list', total_usage: 12.5 })).toEqual([{ id: 'key-balance', label: 'Key balance', unit: 'USD', remaining: 12.5 }])
    expect(() => parseAiHubMixBalance({ total_usage: -1 })).toThrow('no spending limit')
    expect(parseNewApiKeyBalance({ code: true, data: { total_available: 2_500_000, total_used: 2_500_000 } })[0])
      .toMatchObject({ remaining: 5, used: 5, limit: 10, usedPercent: 50 })
    expect(parseNewApiKeyBalance({ code: true, data: { unlimited_quota: true } })[0]).not.toHaveProperty('remaining')
  })
})

describe('balance probe classification and scope', () => {
  const profile = (patch: Record<string, unknown>) => ({ id: 'p', kind: 'http', configured: true, apiKey: 'k', ...patch }) as never
  it('classifies the new vendors by host and the relay by preset', () => {
    expect(classifyProviderQuotaProbe(profile({ baseUrl: 'https://api.siliconflow.cn/v1' }))?.kind).toBe('siliconflow-cn')
    expect(classifyProviderQuotaProbe(profile({ baseUrl: 'https://api.stepfun.ai/v1' }))?.kind).toBe('stepfun-global')
    expect(classifyProviderQuotaProbe(profile({ baseUrl: 'https://aihubmix.com/v1' }))?.kind).toBe('aihubmix')
    expect(classifyProviderQuotaProbe(profile({ presetId: 'cherryin', baseUrl: 'https://open.cherryin.ai/v1' }))?.kind).toBe('new-api')
    expect(classifyProviderQuotaProbe(profile({ baseUrl: 'https://relay.example/v1' }))).toBeNull()
  })
  it('only lets a relay balance request reach the relay host itself', async () => {
    const seen: string[] = []
    const fetcher = async (url: string | URL) => { seen.push(String(url)); return new Response('{}') }
    const scoped = scopedQuotaFetch(fetcher as never, profile({ presetId: 'cherryin', baseUrl: 'https://open.cherryin.ai/v1' }), 'new-api')
    await scoped('https://open.cherryin.ai/api/usage/token', { headers: { authorization: 'Bearer k' } }, '')
    await expect(scoped('https://evil.example/api/usage/token', { headers: { authorization: 'Bearer k' } }, '')).rejects.toThrow('outside')
    expect(seen).toEqual(['https://open.cherryin.ai/api/usage/token'])
  })
})

describe('custom balance endpoint', () => {
  it('reads the value at the URL fragment pointer, or common field names, with the currency when given', () => {
    expect(parseCustomBalance({ data: { wallet: { left: '12.5' } } }, '/data/wallet/left')).toEqual([{ id: 'balance', label: 'Balance', unit: 'USD', remaining: 12.5 }])
    expect(parseCustomBalance({ data: { balance: 3, currency: 'cny' } })).toEqual([{ id: 'balance', label: 'Balance', unit: 'CNY', remaining: 3 }])
    expect(parseCustomBalance({ balance_infos: [{ currency: 'CNY', total_balance: '110.00' }] })[0]).toMatchObject({ unit: 'CNY', remaining: 110 })
    expect(() => parseCustomBalance({ data: {} })).toThrow('#/path/to/value')
    expect(() => parseCustomBalance({ a: 1 }, 'a')).toThrow('JSON pointer')
    expect(jsonPointerPath('/a~1b/c~0d')).toEqual(['a/b', 'c~d'])
  })
  it('only probes HTTPS on the provider host and keeps the fragment out of the request', async () => {
    const base = { id: 'relay', name: 'Relay', kind: 'http' as const, apiKey: 'k', baseUrl: 'https://relay.example/v1' }
    expect(classifyProviderQuotaProbe({ ...base, balanceUrl: 'https://relay.example/api/balance#/data/left' })?.kind).toBe('custom-balance')
    expect(classifyProviderQuotaProbe({ ...base, balanceUrl: 'https://evil.example/api/balance' })).toBeNull()
    expect(classifyProviderQuotaProbe({ ...base, balanceUrl: 'http://relay.example/api/balance' })).toBeNull()
    const seen: string[] = []
    const fetcher = (async (url: string) => { seen.push(String(url)); return new Response(JSON.stringify({ data: { left: 7 } }), { status: 200 }) }) as never
    const result = await runProbe('custom-balance', { ...base, balanceUrl: 'https://relay.example/api/balance#/data/left' },
      { fetcher: scopedQuotaFetch(fetcher, base, 'custom-balance'), proxyUrl: '', apiKey: 'k' }, {})
    expect(result.metrics[0]).toMatchObject({ remaining: 7 })
    expect(seen).toEqual(['https://relay.example/api/balance'])
  })
})
