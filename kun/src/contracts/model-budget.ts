export const MODEL_BUDGET_SCOPES = ['turn', 'thread', 'provider', 'agent', 'workflow'] as const
export type ModelBudgetScope = typeof MODEL_BUDGET_SCOPES[number]

export type ModelBudgetPolicy = {
  scope: ModelBudgetScope
  limitUsd: number
  warningRatio: number
}

export type ModelBudgetUsage = {
  usedUsd: number
}

export type ModelBudgetDecision = {
  scope: ModelBudgetScope
  status: 'allow' | 'warn' | 'deny'
  limitUsd: number
  usedUsd: number
  remainingUsd: number
  warningAtUsd: number
}

export type ModelBudgetValidationError =
  | 'not-an-object'
  | 'unknown-field'
  | 'invalid-scope'
  | 'invalid-limit'
  | 'invalid-warning-ratio'
  | 'invalid-usage'

export type ModelBudgetEvaluation =
  | { ok: true; policy: ModelBudgetPolicy; decision: ModelBudgetDecision }
  | { ok: false; error: ModelBudgetValidationError }

const DEFAULT_WARNING_RATIO = 0.8

export function evaluateModelBudget(policyInput: unknown, usageInput: unknown): ModelBudgetEvaluation {
  const policy = normalizeModelBudgetPolicy(policyInput)
  if (!policy.ok) return policy
  if (!isRecord(usageInput) || !hasOnlyKeys(usageInput, ['usedUsd']) ||
      !isFiniteNonNegativeNumber(usageInput.usedUsd)) {
    return { ok: false, error: 'invalid-usage' }
  }

  const usedUsd = usageInput.usedUsd
  const warningAtUsd = policy.value.limitUsd * policy.value.warningRatio
  const status = usedUsd >= policy.value.limitUsd
    ? 'deny'
    : usedUsd >= warningAtUsd
      ? 'warn'
      : 'allow'
  return {
    ok: true,
    policy: policy.value,
    decision: {
      scope: policy.value.scope,
      status,
      limitUsd: policy.value.limitUsd,
      usedUsd,
      remainingUsd: Math.max(0, policy.value.limitUsd - usedUsd),
      warningAtUsd
    }
  }
}

export function normalizeModelBudgetPolicy(input: unknown):
  | { ok: true; value: ModelBudgetPolicy }
  | { ok: false; error: ModelBudgetValidationError } {
  if (!isRecord(input)) return { ok: false, error: 'not-an-object' }
  if (!hasOnlyKeys(input, ['scope', 'limitUsd', 'warningRatio'])) {
    return { ok: false, error: 'unknown-field' }
  }
  if (!MODEL_BUDGET_SCOPES.includes(input.scope as ModelBudgetScope)) {
    return { ok: false, error: 'invalid-scope' }
  }
  if (!isFinitePositiveNumber(input.limitUsd)) return { ok: false, error: 'invalid-limit' }
  const warningRatio = input.warningRatio === undefined ? DEFAULT_WARNING_RATIO : input.warningRatio
  if (!isFiniteNumber(warningRatio) || warningRatio < 0 || warningRatio > 1) {
    return { ok: false, error: 'invalid-warning-ratio' }
  }
  return {
    ok: true,
    value: {
      scope: input.scope as ModelBudgetScope,
      limitUsd: input.limitUsd,
      warningRatio
    }
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFinitePositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}
