import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GatewayTokenBudget, budgetWindowEnd, type TokenBudgetPolicy } from './gateway-token-budget.js'

const paths: string[] = []
afterEach(async () => { await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const policy: TokenBudgetPolicy = { mode: 'hard', period: 'day', timeZone: 'Asia/Shanghai', tokens: 100 }
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-budget-')); paths.push(dir)
  let time = Date.parse('2026-10-06T06:00:00Z')
  const service = new GatewayTokenBudget(dir, () => time)
  const reserve = (attemptId: string, upperBound = 60, patch: Partial<TokenBudgetPolicy> = {}) => service.reserve({
    clientId: 'client', requestId: 'request', attemptId, policy: { ...policy, ...patch }, upperBound, estimate: 40 })
  return { dir, service, reserve, setTime: (next: number) => { time = next }, time: () => time }
}
describe('durable gateway token admission', () => {
  it('reserves atomically, settles actual usage once, and retains sent unknown usage across restart', async () => {
    const f = await setup()
    const results = await Promise.allSettled([f.reserve('a'), f.reserve('b')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    await f.service.settle('a', 10); await f.service.settle('a', 10)
    await f.reserve('b'); await f.service.settle('b')
    const restarted = new GatewayTokenBudget(f.dir, f.time)
    expect((await restarted.summary('client')).windows[0]).toMatchObject({ measured: 10, reserved: 60 })
    await expect(restarted.reserve({ clientId: 'client', requestId: 'next', attemptId: 'c', policy,
      upperBound: 40, estimate: 30 })).rejects.toThrow('cannot admit')
    expect(await readFile(join(f.dir, 'gateway-token-budget.v1.json'), 'utf8')).not.toContain('prompt')
  })
  it('rejects unbounded hard requests, while soft budgets report excess without inventing measured tokens', async () => {
    const f = await setup()
    await expect(f.service.reserve({ clientId: 'client', requestId: 'r', attemptId: 'a', policy, estimate: 20 })).rejects.toThrow('conservative')
    await f.reserve('b', 200, { mode: 'soft' })
    expect((await f.service.summary('client', policy)).windows[0]).toMatchObject({ exceeded: true, measured: 0, reserved: 200 })
  })
  it('keeps the open time zone until its boundary and applies changed limits immediately', async () => {
    const f = await setup(); await f.reserve('a', 20)
    await expect(f.reserve('b', 20, { tokens: 30, timeZone: 'UTC' })).rejects.toThrow('cannot admit')
    await f.reserve('b', 20, { timeZone: 'UTC' })
    expect((await f.service.summary('client')).windows[0].timeZone).toBe('Asia/Shanghai')
    f.setTime(Date.parse('2026-10-07T00:00:01Z'))
    await f.reserve('c', 20, { timeZone: 'UTC' })
    expect((await f.service.summary('client')).windows.find((window) => window.active)?.timeZone).toBe('UTC')
  })
  it('calculates daily DST, Monday weekly and monthly boundaries in the configured IANA zone', () => {
    expect(new Date(budgetWindowEnd(Date.parse('2026-03-08T07:30:00Z'), { period: 'day', timeZone: 'America/New_York' })).toISOString()).toBe('2026-03-09T04:00:00.000Z')
    expect(new Date(budgetWindowEnd(Date.parse('2026-10-06T06:00:00Z'), { period: 'week', timeZone: 'Asia/Shanghai' })).toISOString()).toBe('2026-10-11T16:00:00.000Z')
    expect(new Date(budgetWindowEnd(Date.parse('2026-10-06T06:00:00Z'), { period: 'month', timeZone: 'UTC' })).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})
