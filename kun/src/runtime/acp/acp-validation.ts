import type { z } from 'zod'
import { acpDiagnosticText } from './acp-diagnostic-text.js'

/** Standard JSON-RPC 2.0 error codes plus Kun's policy denial code. */
export const ACP_RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Kun policy rejected a client-mediated action (write/command). */
  policyDenied: -32001,
  /** The sessionId has no live host context (turn ended or unknown). */
  sessionUnavailable: -32002
} as const

export type AcpErrorCode =
  /** Malformed frame, oversized line, or missing/invalid required field. */
  | 'harness_protocol_error'
  /** Process died while requests were outstanding. */
  | 'harness_crashed'
  /** Agent returned a JSON-RPC error object for the request. */
  | 'agent_error'
  /** Kun policy rejected an agent-requested client action. */
  | 'policy_denied'
  | 'request_timeout'
  | 'request_aborted'
  | 'connection_closed'

export class AcpError extends Error {
  readonly code: AcpErrorCode
  readonly rpcCode?: number
  readonly data?: unknown

  constructor(
    code: AcpErrorCode,
    message: string,
    options: { rpcCode?: number; data?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AcpError'
    this.code = code
    if (options.rpcCode !== undefined) this.rpcCode = options.rpcCode
    if (options.data !== undefined) this.data = options.data
  }
}

export type AcpValidationIssue = {
  path: string
  code: string
  message: string
}

const MAX_VALIDATION_ISSUES = 8
const MAX_ISSUE_MESSAGE_CHARS = 256
const MAX_DETAIL_DEPTH = 4
const MAX_DETAIL_ENTRIES = 16
const MAX_DETAIL_STRING_CHARS = 512
const SENSITIVE_DETAIL_KEY =
  /(?:api[_-]?key|access[_-]?key|auth|authorization|cookie|credential|passwd|password|private[_-]?key|secret|session[_-]?token|token)/i

/** Truncate display text without splitting a UTF-16 surrogate pair. */
export function truncateAcpDisplayText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= 3) return text.slice(0, Math.max(0, maxChars))
  let end = maxChars - 3
  const prev = text.charCodeAt(end - 1)
  if (prev >= 0xd800 && prev <= 0xdbff) end -= 1
  return `${text.slice(0, end)}...`
}

export function formatAcpZodIssues(
  error: z.ZodError,
  maxIssues = MAX_VALIDATION_ISSUES
): AcpValidationIssue[] {
  return error.issues.slice(0, maxIssues).map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : 'payload',
    code: String(issue.code),
    message: acpDiagnosticText(issue.message, MAX_ISSUE_MESSAGE_CHARS)
  }))
}

export function summarizeAcpValidationIssues(issues: readonly AcpValidationIssue[]): string {
  return issues
    .map((issue) =>
      issue.message
        ? `${issue.path} (${issue.code}: ${issue.message})`
        : `${issue.path} (${issue.code})`
    )
    .join(', ')
}

export function acpValidationError(
  subject: string,
  error: z.ZodError,
  options: { rpcCode?: number; prefix?: string } = {}
): AcpError {
  const issues = formatAcpZodIssues(error)
  const summary = summarizeAcpValidationIssues(issues)
  const headline = options.prefix
    ? `${options.prefix}: ${summary}`
    : `${subject}: invalid ${summary}`
  return new AcpError('harness_protocol_error', headline, {
    ...(options.rpcCode !== undefined ? { rpcCode: options.rpcCode } : {}),
    data: { issues }
  })
}

/** Bound and redact structured ACP error details before persisting or returning them. */
export function sanitizeAcpErrorDetails(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return acpDiagnosticText(value, MAX_DETAIL_STRING_CHARS)
  if (depth >= MAX_DETAIL_DEPTH) return '[truncated]'
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DETAIL_ENTRIES)
      .map((entry) => sanitizeAcpErrorDetails(entry, depth + 1))
      .filter((entry) => entry !== undefined)
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value).slice(0, MAX_DETAIL_ENTRIES)) {
      if (entry === undefined) continue
      const safeKey = acpDiagnosticText(key, 128)
      if (!safeKey) continue
      if (SENSITIVE_DETAIL_KEY.test(safeKey)) {
        out[safeKey] = '[redacted]'
        continue
      }
      const sanitized = sanitizeAcpErrorDetails(entry, depth + 1)
      if (sanitized !== undefined) out[safeKey] = sanitized
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return undefined
}
