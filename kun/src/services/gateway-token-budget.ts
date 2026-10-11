import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonFile, assertManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import type { GatewayClientPolicy } from '../contracts/gateway-client-policy.js'

export type TokenBudgetPolicy = NonNullable<GatewayClientPolicy['tokenBudget']>
const Window = z.object({ id: z.string(), clientId: z.string(), period: z.enum(['day', 'week', 'month']),
  timeZone: z.string(), endsAt: z.number(), measured: z.number().nonnegative(), reserved: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().default(0), unknownCostAttempts: z.number().int().nonnegative().default(0) })
const Entry = z.object({ windowId: z.string(), requestId: z.string(), reserved: z.number().nonnegative(),
  status: z.enum(['dispatched', 'pending', 'settled']), measured: z.number().nonnegative().optional(), at: z.number(),
  costStatus: z.enum(['unknown', 'known']).optional() })
const State = z.object({ schemaVersion: z.literal(1), windows: z.record(z.string(), Window),
  attempts: z.record(z.string(), Entry) })
type State = z.infer<typeof State>
const empty = (): State => ({ schemaVersion: 1, windows: {}, attempts: {} })

export class GatewayBudgetError extends Error {
  constructor(readonly code: 'token_budget_exceeded' | 'token_budget_unbounded' | 'token_budget_unavailable' | 'cost_limit_exceeded', message: string,
    /** When the refusing window ends (epoch ms), for budget and cost refusals. */
    readonly resetsAt?: number) {
    super(message)
  }
}

/** Reservations are persisted before network dispatch. Unknown usage never refunds a sent attempt. */
export class GatewayTokenBudget {
  private readonly file: AtomicJsonFile<State>
  constructor(dataDir: string, private readonly now = Date.now) {
    const path = join(dataDir, 'gateway-token-budget.v1.json')
    assertManagerAtomicJsonPath(path)
    this.file = new AtomicJsonFile(path, (value) => {
      const state = State.parse(value)
      // Older ledgers tracked tokens only. Their absent prices are unknown, never zero.
      for (const entry of Object.values(state.attempts)) if (!entry.costStatus) {
        entry.costStatus = 'unknown'
        const window = state.windows[entry.windowId]
        if (window) window.unknownCostAttempts += 1
      }
      return state
    }, false)
  }

  async reserve(input: { clientId: string; requestId: string; attemptId: string; policy: TokenBudgetPolicy;
    upperBound?: number; estimate: number; costLimitUsd?: number }): Promise<void> {
    if (input.policy.mode === 'hard' && (!input.upperBound || !Number.isSafeInteger(input.upperBound))) {
      throw new GatewayBudgetError('token_budget_unbounded', 'This request has no declared conservative input bound. Configure the account input ceiling and an explicit output limit, or select a soft budget.')
    }
    const amount = input.upperBound ?? input.estimate
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new GatewayBudgetError('token_budget_unbounded', 'Invalid token reservation bound.')
    await this.file.update(empty, (state) => {
      const existing = state.attempts[input.attemptId]
      if (existing) {
        if (existing.requestId !== input.requestId || existing.reserved !== amount) throw new Error('Budget attempt identity conflict')
        return state
      }
      this.prune(state)
      if (Object.keys(state.attempts).length >= 10_000) throw new GatewayBudgetError('token_budget_unavailable', 'Budget reservations require reconciliation before more requests can be admitted.')
      // Period/time-zone changes take effect after the open window; limits apply immediately.
      let window = Object.values(state.windows).find((item) => item.clientId === input.clientId && item.endsAt > this.now())
      if (!window) {
        const id = `${input.clientId}:${this.now()}:${input.attemptId}`
        window = { id, clientId: input.clientId, period: input.policy.period, timeZone: input.policy.timeZone,
          endsAt: budgetWindowEnd(this.now(), input.policy), measured: 0, reserved: 0, estimatedCostUsd: 0, unknownCostAttempts: 0 }
        state.windows[id] = window
      }
      // A cost limit is a reference estimate: unknown-price attempts add nothing, so it can only be reached, never pre-reserved.
      if (input.costLimitUsd !== undefined && window.estimatedCostUsd >= input.costLimitUsd) {
        throw new GatewayBudgetError('cost_limit_exceeded', 'The gateway client reached its estimated cost limit for this period.', window.endsAt)
      }
      if (input.policy.mode === 'hard' && window.measured + window.reserved + amount > input.policy.tokens) {
        throw new GatewayBudgetError('token_budget_exceeded', 'The gateway client token budget cannot admit another upstream attempt.', window.endsAt)
      }
      window.reserved += amount
      window.unknownCostAttempts += 1
      state.attempts[input.attemptId] = { windowId: window.id, requestId: input.requestId,
        reserved: amount, status: 'dispatched', costStatus: 'unknown', at: this.now() }
      return state
    })
  }

  async settle(attemptId: string, measured?: number, estimatedCostUsd?: number): Promise<void> {
    if (measured !== undefined && (!Number.isSafeInteger(measured) || measured < 0)) throw new Error('Invalid measured usage')
    if (estimatedCostUsd !== undefined && (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0)) throw new Error('Invalid cost estimate')
    await this.file.update(empty, (state) => {
      const entry = state.attempts[attemptId]
      if (!entry || entry.status === 'settled') return state
      const window = state.windows[entry.windowId]
      if (entry.costStatus !== 'known') {
        if (estimatedCostUsd !== undefined) {
          window.estimatedCostUsd += estimatedCostUsd
          if (entry.costStatus === 'unknown') window.unknownCostAttempts = Math.max(0, window.unknownCostAttempts - 1)
          entry.costStatus = 'known'
        } else if (!entry.costStatus) {
          window.unknownCostAttempts += 1; entry.costStatus = 'unknown'
        }
      }
      if (measured === undefined) { entry.status = 'pending'; return state }
      window.reserved -= entry.reserved
      window.measured += measured
      entry.measured = measured; entry.status = 'settled'
      return state
    })
  }

  async summary(clientId: string, policy?: TokenBudgetPolicy, costAlert?: GatewayClientPolicy['costAlert']) {
    const state = await this.file.read(empty)
    const windows = Object.values(state.windows).filter((window) => window.clientId === clientId)
    return { windows: windows.map((window) => ({ ...window,
      active: window.endsAt > this.now(), ...(policy ? { limit: policy.tokens,
        exceeded: window.measured + window.reserved > policy.tokens } : {}),
        ...(costAlert ? { costAlert: { basis: 'reference-estimate', usd: window.estimatedCostUsd,
          unknownAttempts: window.unknownCostAttempts, limitUsd: costAlert.usd,
          exceeded: window.estimatedCostUsd >= costAlert.usd,
          period: window.period, timeZone: window.timeZone } } : {}) })),
    pendingAttempts: Object.entries(state.attempts).filter(([, entry]) => entry.status !== 'settled' &&
      windows.some((window) => window.id === entry.windowId)).map(([attemptId, entry]) => ({ attemptId, ...entry })) }
  }

  private prune(state: State): void {
    const settled = Object.entries(state.attempts).filter(([, entry]) => entry.status === 'settled').sort((a, b) => b[1].at - a[1].at)
    for (const [id] of settled.slice(2_000)) delete state.attempts[id]
    const referenced = new Set(Object.values(state.attempts).map((entry) => entry.windowId))
    for (const [id, window] of Object.entries(state.windows)) {
      if (window.endsAt < this.now() - 90 * 86_400_000 && !referenced.has(id)) delete state.windows[id]
    }
  }
}

export function budgetWindowEnd(now: number, policy: Pick<TokenBudgetPolicy, 'period' | 'timeZone'>): number {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: policy.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const label = (time: number) => {
    const parts = Object.fromEntries(format.formatToParts(time).map((part) => [part.type, part.value]))
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
    if (policy.period === 'month') return `${parts.year}-${parts.month}`
    if (policy.period === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
    return date.toISOString().slice(0, 10)
  }
  const current = label(now)
  let lo = Math.floor(now / 1000), hi = lo + 40 * 86_400
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (label(mid * 1000) === current) lo = mid; else hi = mid }
  return hi * 1000
}
