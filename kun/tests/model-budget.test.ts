import { describe, expect, it } from 'vitest'
import { evaluateModelBudget, normalizeModelBudgetPolicy } from '../src/contracts/model-budget.js'

describe('model budget contract', () => {
  it('allows usage below the warning threshold', () => {
    expect(evaluateModelBudget({ scope: 'thread', limitUsd: 10 }, { usedUsd: 7 })).toMatchObject({
      ok: true,
      decision: { status: 'allow', remainingUsd: 3, warningAtUsd: 8 }
    })
  })

  it('warns at the threshold and denies at or above the limit', () => {
    const warning = evaluateModelBudget({ scope: 'provider', limitUsd: 10, warningRatio: 0.5 }, { usedUsd: 5 })
    const denied = evaluateModelBudget({ scope: 'provider', limitUsd: 10, warningRatio: 0.5 }, { usedUsd: 11 })
    expect(warning.ok).toBe(true)
    expect(denied.ok).toBe(true)
    if (warning.ok && denied.ok) {
      expect(warning.decision).toMatchObject({ status: 'warn', remainingUsd: 5 })
      expect(denied.decision).toMatchObject({ status: 'deny', remainingUsd: 0 })
    }
  })

  it('supports all defined scopes and normalizes the default warning ratio', () => {
    for (const scope of ['turn', 'thread', 'provider', 'agent', 'workflow'] as const) {
      expect(normalizeModelBudgetPolicy({ scope, limitUsd: 1 })).toEqual({
        ok: true,
        value: { scope, limitUsd: 1, warningRatio: 0.8 }
      })
    }
  })

  it.each([
    [{ scope: 'session', limitUsd: 1 }, 'invalid-scope'],
    [{ scope: 'thread', limitUsd: 0 }, 'invalid-limit'],
    [{ scope: 'thread', limitUsd: 1, warningRatio: 2 }, 'invalid-warning-ratio'],
    [{ scope: 'thread', limitUsd: 1, extra: true }, 'unknown-field']
  ])('rejects invalid policies %#', (input, error) => {
    expect(normalizeModelBudgetPolicy(input)).toEqual({ ok: false, error })
  })

  it('rejects negative, infinite, and extra usage fields', () => {
    expect(evaluateModelBudget({ scope: 'turn', limitUsd: 1 }, { usedUsd: -1 })).toEqual({ ok: false, error: 'invalid-usage' })
    expect(evaluateModelBudget({ scope: 'turn', limitUsd: 1 }, { usedUsd: Infinity })).toEqual({ ok: false, error: 'invalid-usage' })
    expect(evaluateModelBudget({ scope: 'turn', limitUsd: 1 }, { usedUsd: 0, tokenCount: 1 })).toEqual({ ok: false, error: 'invalid-usage' })
  })
})
