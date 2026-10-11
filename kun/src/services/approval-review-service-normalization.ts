import { randomUUID } from 'node:crypto'
import {
  ApprovalActionEnvelopeSchema,
  ApprovalReviewDecisionSchema,
  type ApprovalActionEnvelope,
  type ApprovalReviewDecision,
  type ApprovalReviewTerminalStatus
} from '../contracts/approvals.js'
import {
  redactApprovalSensitiveText,
  safeApprovalActionSummary
} from '../domain/approval.js'
import { makeUserItem } from '../domain/item.js'
import type {
  ApprovalReviewInput,
  ApprovalReviewPort,
  ApprovalReviewResult
} from '../ports/approval-review.js'
import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk
} from '../ports/model-client.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { UsageService } from './usage-service.js'
import { utf8PrefixWithinBytes } from '../shared/utf8-text-blocks.js'
import { MAX_MODEL_OUTPUT_BYTES, MAX_REVIEW_ARGUMENT_DEPTH, MAX_REVIEW_ARGUMENT_ITEMS, MAX_REVIEW_ARGUMENT_KEYS, MAX_REVIEW_ARGUMENT_STRING_BYTES } from './approval-review-service-core.js'

export function normalizeReviewArguments(
  value: Record<string, unknown>
): { value: Record<string, unknown>; truncated: boolean } {
  const state = {
    truncated: false,
    seen: new WeakSet<object>()
  }
  const normalized = normalizeReviewValue(value, undefined, 0, state)
  if (!isPlainRecord(normalized)) {
    return {
      value: { __truncated__: true },
      truncated: true
    }
  }
  return { value: normalized, truncated: state.truncated }
}

export function normalizeReviewValue(
  value: unknown,
  key: string | undefined,
  depth: number,
  state: { truncated: boolean; seen: WeakSet<object> }
): unknown {
  if (key && isSensitiveArgumentKey(key)) return '[redacted]'
  if (key === '__truncated__' && value === true) state.truncated = true
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') {
    state.truncated = true
    return value.toString()
  }
  if (typeof value === 'string') {
    const redacted = redactOutput(value)
    const bounded = boundedText(redacted, MAX_REVIEW_ARGUMENT_STRING_BYTES)
    if (bounded.includes('[truncated')) state.truncated = true
    if (bounded !== redacted) state.truncated = true
    return bounded
  }
  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    state.truncated = true
    return `[unsupported:${typeof value}]`
  }
  if (depth >= MAX_REVIEW_ARGUMENT_DEPTH) {
    state.truncated = true
    return '[truncated:depth]'
  }
  if (typeof value !== 'object') {
    state.truncated = true
    return `[unsupported:${typeof value}]`
  }
  if (state.seen.has(value)) {
    state.truncated = true
    return '[truncated:circular]'
  }
  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      const entries = value.slice(0, MAX_REVIEW_ARGUMENT_ITEMS)
      if (entries.length !== value.length) state.truncated = true
      return entries.map((entry) =>
        normalizeReviewValue(entry, key, depth + 1, state)
      )
    }
    if (!isPlainRecord(value)) {
      state.truncated = true
      return `[unsupported:${Object.prototype.toString.call(value)}]`
    }
    const output: Record<string, unknown> = {}
    const entries = Object.entries(value)
    for (const [rawKey, entry] of entries.slice(0, MAX_REVIEW_ARGUMENT_KEYS)) {
      const safeKey = boundedText(rawKey, 128)
      if (safeKey !== rawKey) state.truncated = true
      output[safeKey] = normalizeReviewValue(entry, safeKey, depth + 1, state)
    }
    if (entries.length > MAX_REVIEW_ARGUMENT_KEYS) state.truncated = true
    return output
  } finally {
    state.seen.delete(value)
  }
}

export function safeMissingActionSummary(input: ApprovalReviewInput): string {
  const summary = boundedText(
    redactOutput(input.approval.summary.trim()),
    2_048
  )
  return summary || boundedText(
    `Automatic review for ${redactOutput(input.approval.toolName)}`,
    2_048
  )
}

export function isSensitiveArgumentKey(value: string): boolean {
  const normalized = value.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'credential' ||
    normalized === 'credentials' ||
    normalized === 'password' ||
    normalized === 'privatekey' ||
    normalized === 'session' ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('password') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('privatekey')
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function utf8Bytes(value: string): number {
  return utf8PrefixWithinBytes(value, 0, Number.MAX_SAFE_INTEGER).bytes
}

export function normalizeRoute(
  route: ApprovalReviewInput['route']
): NonNullable<ApprovalReviewInput['route']> | null {
  const model = route?.model.trim() ?? ''
  if (!model) return null
  const providerId = route?.providerId?.trim()
  const accountId = route?.accountId?.trim()
  return {
    model,
    ...(route?.unresolvedGatewayAlias ? { unresolvedGatewayAlias: true as const } : {}),
    ...(route?.requestedGatewayAlias ? { requestedGatewayAlias: route.requestedGatewayAlias } : {}),
    ...(providerId ? { providerId } : {}),
    ...(accountId ? { accountId } : {})
  }
}

export function appendBoundedOutput(current: string, delta: string): string {
  const remaining = MAX_MODEL_OUTPUT_BYTES -
    utf8PrefixWithinBytes(current, 0, Number.MAX_SAFE_INTEGER).bytes
  if (remaining <= 0) return current
  return `${current}${boundedText(delta, remaining)}`
}

export function boundedText(value: string, maxBytes: number): string {
  const { end } = utf8PrefixWithinBytes(value, 0, Math.max(0, maxBytes))
  return value.slice(0, end)
}

export function redactOutput(value: string): string {
  return redactApprovalSensitiveText(value)
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return boundedText(redactOutput(message || 'unknown model failure'), 1_024)
}
