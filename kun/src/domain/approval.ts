import type {
  ApprovalActionEnvelope,
  ApprovalActionKind,
  ApprovalActionTarget,
  ApprovalReviewTerminalStatus
} from '../contracts/approvals.js'
import type {
  ToolEffects,
  ToolProviderKind
} from '../ports/tool-host.js'
import {
  redactBrowserUseActionForPersistence,
  redactBrowserUseUrl
} from '../contracts/browser-use.js'
import { utf8PrefixWithinBytes } from '../shared/utf8-text-blocks.js'
import { projectToolArgumentsForPersistence } from './tool-argument-envelope.js'

export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired'

export type ApprovalResolution = {
  decision: 'allow' | 'deny'
  reason?: string
  reviewer?: 'user' | 'agent'
  reviewId?: string
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  reviewStatus?: ApprovalReviewTerminalStatus
}

/**
 * A pending approval request surfaced by the loop. The runtime stores
 * approval records so that an SSE subscriber can replay the request to
 * late joiners and so the HTTP approval endpoint can look the record
 * up by id.
 */
export type ApprovalRequest = {
  id: string
  threadId: string
  turnId: string
  toolName: string
  summary: string
  /** Safe host-authored action data used by automatic approval review. */
  action?: ApprovalActionEnvelope
  status: ApprovalStatus
  createdAt: string
  decidedAt?: string
  reason?: string
}

export function createApprovalRequest(input: {
  id: string
  threadId: string
  turnId: string
  toolName: string
  summary: string
  action?: ApprovalActionEnvelope
  createdAt?: string
}): ApprovalRequest {
  return {
    id: input.id,
    threadId: input.threadId,
    turnId: input.turnId,
    toolName: input.toolName,
    summary: input.summary,
    ...(input.action ? { action: input.action } : {}),
    status: 'pending',
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}

const MAX_ACTION_ARGUMENT_BYTES = 12 * 1024
const MAX_ACTION_STRING_BYTES = 1_024
const MAX_ACTION_KEYS = 32
const MAX_ACTION_ARRAY_ITEMS = 24
const MAX_ACTION_DEPTH = 4
const MAX_ACTION_TARGETS = 16
const MAX_ACTION_TARGET_BYTES = 2_048
const REDACTED = '[redacted]'
const SENSITIVE_KEYS = new Set([
  'apikey',
  'accesskey',
  'accesskeyid',
  'authorization',
  'awsaccesskeyid',
  'awssecretaccesskey',
  'awssecuritytoken',
  'awssessiontoken',
  'cookie',
  'credential',
  'credentials',
  'password',
  'passwd',
  'privatekey',
  'refreshtoken',
  'secret',
  'session',
  'sessionid',
  'token',
  'accesstoken',
  'authtoken',
  'secretaccesskey'
])
const COMMAND_KEYS = new Set(['command', 'cmd', 'script'])
const FILE_KEYS = new Set([
  'path',
  'file',
  'file_path',
  'filepath',
  'source',
  'source_path',
  'destination',
  'destination_path',
  'target_path',
  'cwd'
])
const URL_KEYS = new Set(['url', 'uri', 'endpoint', 'origin', 'host'])
const RECIPIENT_KEYS = new Set([
  'recipient',
  'recipients',
  'to',
  'cc',
  'bcc',
  'email',
  'emails',
  'channel',
  'channel_id',
  'conversation',
  'chat_id',
  'room',
  'user'
])

export type ApprovalActionEnvelopeInput = {
  toolName: string
  providerId?: string
  providerKind?: ToolProviderKind
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  effects?: ToolEffects
  arguments: Record<string, unknown>
  workspace: string
  cwd?: string
  exactFileTargets?: readonly string[]
  reason: string
  /** Marks actions that only a human may authorize (never auto-allowed). */
  requiresUserDecision?: boolean
}

/**
 * Builds the only action representation accepted by automatic review.
 * Everything is copied, bounded and credential-redacted at this boundary.
 */
export function createApprovalActionEnvelope(
  input: ApprovalActionEnvelopeInput
): ApprovalActionEnvelope {
  const effects: ToolEffects = {
    network: input.effects?.network === true,
    externalWrite: input.effects?.externalWrite === true,
    processExecution: input.effects?.processExecution === true,
    guiAutomation: input.effects?.guiAutomation === true
  }
  const normalization = {
    remaining: MAX_ACTION_ARGUMENT_BYTES,
    truncated: false
  }
  // Browser actions can carry arbitrary signed/query credentials or literal
  // text. Review and durable audit receive only the canonical redacted shape;
  // execution authority remains bound separately to the untouched raw args.
  const reviewArguments = input.toolName === 'browser_use'
    ? redactBrowserUseActionForPersistence(input.arguments) as Record<string, unknown>
    : input.arguments
  const normalizedArguments = normalizeApprovalValue(
    projectToolArgumentsForPersistence(reviewArguments).arguments,
    undefined,
    0,
    normalization
  )
  const normalizedRecord = isPlainRecord(normalizedArguments) ? normalizedArguments : {}
  const arguments_ = normalization.truncated
    ? { ...normalizedRecord, __truncated__: true }
    : normalizedRecord
  const kind = inferApprovalActionKind(input, effects)
  // Security-critical targets are extracted independently from the original
  // arguments. A bounded display copy may omit data, but it must never hide the
  // command/path/URL/recipient that the reviewer is authorizing.
  const targets = collectApprovalTargets(input, input.arguments)
  return Object.freeze({
    version: 1 as const,
    kind,
    toolName: boundedText(input.toolName.trim() || 'unknown-tool', 256),
    ...(input.providerId?.trim()
      ? { providerId: boundedText(input.providerId.trim(), 256) }
      : {}),
    ...(input.providerKind ? { providerKind: input.providerKind } : {}),
    ...(input.toolKind ? { toolKind: input.toolKind } : {}),
    effects,
    arguments: arguments_,
    workspace: boundedText(input.workspace, 4_096),
    ...(input.cwd?.trim()
      ? { cwd: boundedText(redactApprovalSensitiveText(input.cwd), 4_096) }
      : {}),
    targets,
    reason: boundedText(
      redactApprovalSensitiveText(input.reason.trim() || 'approval required'),
      2_048
    ),
    ...(input.requiresUserDecision === true ? { requiresUserDecision: true } : {})
  })
}

export function safeApprovalActionSummary(action: ApprovalActionEnvelope): string {
  const targets = action.targets
    .slice(0, 3)
    .map((target) => `${target.kind}=${JSON.stringify(target.value)}`)
    .join(', ')
  const suffix = targets ? `: ${targets}` : ''
  return boundedText(`Review ${action.kind} action ${action.toolName}${suffix}`, 2_048)
}

function inferApprovalActionKind(
  input: ApprovalActionEnvelopeInput,
  effects: ToolEffects
): ApprovalActionKind {
  if (input.toolKind === 'command_execution' || effects.processExecution) return 'command'
  if (input.toolKind === 'file_change' || input.exactFileTargets?.length) {
    return 'file'
  }
  if (effects.guiAutomation && effects.externalWrite) return 'external-effect'
  if (effects.externalWrite) return 'file'
  if (input.providerKind === 'mcp') return 'mcp'
  if (effects.network || input.providerKind === 'web') return 'network'
  if (effects.guiAutomation || input.providerKind === 'extension') return 'external-effect'
  return 'unknown'
}

function collectApprovalTargets(
  input: ApprovalActionEnvelopeInput,
  args: Record<string, unknown>
): ApprovalActionTarget[] {
  const targets: ApprovalActionTarget[] = []
  const add = (target: ApprovalActionTarget): void => {
    const value = redactApprovalSensitiveText(target.value)
    if (!value.trim()) {
      throw new Error(`approval ${target.kind} target is empty`)
    }
    if (boundedText(value, MAX_ACTION_TARGET_BYTES) !== value) {
      throw new Error(
        `approval ${target.kind} target exceeds the safe ${MAX_ACTION_TARGET_BYTES}-byte limit`
      )
    }
    if (targets.some((candidate) =>
      candidate.kind === target.kind && candidate.value === value
    )) {
      return
    }
    if (targets.length >= MAX_ACTION_TARGETS) {
      throw new Error(
        `approval action has more than ${MAX_ACTION_TARGETS} distinct security-critical targets`
      )
    }
    targets.push({ kind: target.kind, value })
  }
  for (const path of input.exactFileTargets ?? []) add({ kind: 'file', value: path })
  const targetEntries = [
    ...Object.entries(args)
  ]
  for (const [rawKey, value] of targetEntries) {
    const key = rawKey.toLowerCase()
    const targetKind = COMMAND_KEYS.has(key)
      ? 'command' as const
      : FILE_KEYS.has(key)
        ? 'file' as const
        : URL_KEYS.has(key)
          ? 'url' as const
          : RECIPIENT_KEYS.has(key)
            ? 'recipient' as const
            : undefined
    if (!targetKind || value === null || value === undefined) continue
    const values = approvalTargetValues(value)
    if (!values) {
      throw new Error(
        `approval ${targetKind} target ${rawKey} cannot be represented exactly`
      )
    }
    for (const candidate of values) {
      add({
        kind: targetKind,
        value: targetKind === 'url'
          ? input.toolName === 'browser_use'
            ? redactBrowserUseUrl(candidate)
            : sanitizeUrl(candidate)
          : candidate
      })
    }
  }
  if (input.toolName === 'browser_use' && isPlainRecord(args.expectedTarget)) {
    const expectedTarget = args.expectedTarget
    const sanitizedUrl = exactApprovalTargetString(
      expectedTarget.sanitizedUrl,
      'browser expectedTarget.sanitizedUrl'
    )
    const origin = exactApprovalTargetString(
      expectedTarget.origin,
      'browser expectedTarget.origin'
    )
    const sessionId = exactApprovalTargetString(
      expectedTarget.sessionId,
      'browser expectedTarget.sessionId'
    )
    const tabId = exactApprovalTargetString(
      expectedTarget.tabId,
      'browser expectedTarget.tabId'
    )
    const role = exactApprovalTargetString(
      expectedTarget.role,
      'browser expectedTarget.role'
    )
    const name = exactApprovalTargetString(
      expectedTarget.name,
      'browser expectedTarget.name'
    )
    const documentGeneration = expectedTarget.documentGeneration
    if (
      typeof documentGeneration !== 'number' ||
      !Number.isSafeInteger(documentGeneration) ||
      documentGeneration < 0
    ) {
      throw new Error(
        'approval browser expectedTarget.documentGeneration cannot be represented exactly'
      )
    }
    add({ kind: 'url', value: sanitizeUrl(sanitizedUrl) })
    add({ kind: 'url', value: sanitizeUrl(origin) })
    add({
      kind: 'resource',
      value: `browser-target ${JSON.stringify({
        sessionId,
        tabId,
        documentGeneration,
        role,
        name
      })}`
    })
  }
  if (input.providerKind === 'mcp') {
    add({
      kind: 'mcp',
      value: `${input.providerId?.trim() || 'mcp'}:${input.toolName}`
    })
  }
  if (!targets.length) {
    add({
      kind: 'resource',
      value: boundedText(input.toolName.trim() || 'unknown-tool', 256)
    })
  }
  return targets
}

function exactApprovalTargetString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`approval ${label} cannot be represented exactly`)
  }
  return value
}

function approvalTargetValues(value: unknown): string[] | null {
  if (typeof value === 'string') return value.trim() ? [value] : null
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)]
  if (typeof value === 'bigint') return [value.toString()]
  if (!Array.isArray(value)) return null
  const values: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) values.push(entry)
    else if (typeof entry === 'number' && Number.isFinite(entry)) values.push(String(entry))
    else if (typeof entry === 'bigint') values.push(entry.toString())
    else return null
  }
  return values
}

function normalizeApprovalValue(
  value: unknown,
  key: string | undefined,
  depth: number,
  state: { remaining: number; truncated: boolean }
): unknown {
  if (key && isSensitiveKey(key)) return REDACTED
  if (state.remaining <= 0) {
    state.truncated = true
    return '[truncated]'
  }
  if (value === null || typeof value === 'boolean') {
    state.remaining -= 8
    return value
  }
  if (typeof value === 'number') {
    state.remaining -= 24
    return Number.isFinite(value) ? value : String(value)
  }
  if (typeof value === 'bigint') {
    state.remaining -= 32
    return value.toString()
  }
  if (typeof value === 'string') {
    const redacted = redactApprovalSensitiveText(value)
    const cap = Math.min(MAX_ACTION_STRING_BYTES, Math.max(0, state.remaining))
    const normalized = boundedText(redacted, cap)
    if (normalized !== redacted) state.truncated = true
    state.remaining -= utf8PrefixWithinBytes(
      normalized,
      0,
      Number.MAX_SAFE_INTEGER
    ).bytes
    return normalized
  }
  if (depth >= MAX_ACTION_DEPTH) {
    state.truncated = true
    return '[truncated]'
  }
  if (Array.isArray(value)) {
    const output: unknown[] = []
    for (const entry of value.slice(0, MAX_ACTION_ARRAY_ITEMS)) {
      if (state.remaining <= 0) {
        state.truncated = true
        break
      }
      output.push(normalizeApprovalValue(entry, key, depth + 1, state))
    }
    if (value.length > output.length) {
      state.truncated = true
      if (state.remaining > 0) output.push('[truncated]')
    }
    return output
  }
  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {}
    const allEntries = Object.entries(value)
    const entries = allEntries.slice(0, MAX_ACTION_KEYS)
    let processed = 0
    for (const [rawKey, entry] of entries) {
      if (state.remaining <= 0) {
        state.truncated = true
        break
      }
      const safeKey = boundedText(rawKey, 128)
      if (safeKey !== rawKey || Object.hasOwn(output, safeKey)) state.truncated = true
      state.remaining -= Math.min(128, safeKey.length)
      output[safeKey] = normalizeApprovalValue(entry, safeKey, depth + 1, state)
      processed += 1
    }
    if (allEntries.length > processed) state.truncated = true
    return output
  }
  state.remaining -= 16
  return `[${typeof value}]`
}

export function redactApprovalSensitiveText(value: string): string {
  let output = redactPemPrivateKeys(value)
    .replace(
      /\b(gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/gi,
      '[redacted]'
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED)
    .replace(
      /\b((?:aws_)?(?:access_key_id|secret_access_key|session_token)\s*(?:=|:|\s)\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;]+)/gi,
      '$1[redacted]'
    )
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:_TOKEN|_SECRET|_KEY|_PASSWORD)\s*=\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;]+)/gi,
      '$1[redacted]'
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, REDACTED)
    .replace(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, REDACTED)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
  output = output.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    '$1[redacted]@'
  )
  return output
}

type PemBoundary = {
  end: number
  label: string
}

function pemBoundaryAt(
  value: string,
  index: number,
  kind: 'BEGIN' | 'END'
): PemBoundary | undefined {
  const prefix = `-----${kind} `
  if (value.slice(index, index + prefix.length).toUpperCase() !== prefix) return undefined
  let cursor = index + prefix.length
  const labelStart = cursor
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor)
    const isDigit = code >= 48 && code <= 57
    const isUpper = code >= 65 && code <= 90
    const isLower = code >= 97 && code <= 122
    if (!isDigit && !isUpper && !isLower && code !== 32) break
    cursor += 1
  }
  if (
    cursor === labelStart ||
    value.slice(cursor, cursor + 5) !== '-----'
  ) return undefined
  const label = value.slice(labelStart, cursor).toUpperCase()
  if (!label.endsWith('PRIVATE KEY')) return undefined
  return { end: cursor + 5, label }
}

function redactPemPrivateKeys(value: string): string {
  let active: { start: number; label: string } | undefined
  let segmentStart = 0
  let output = ''
  let index = 0
  while (index < value.length) {
    if (value.charCodeAt(index) !== 45) {
      index += 1
      continue
    }
    if (!active) {
      const begin = pemBoundaryAt(value, index, 'BEGIN')
      if (!begin) {
        index += 1
        continue
      }
      active = { start: index, label: begin.label }
      index = begin.end
      continue
    }
    const end = pemBoundaryAt(value, index, 'END')
    if (!end || end.label !== active.label) {
      index += 1
      continue
    }
    output += `${value.slice(segmentStart, active.start)}[redacted private key]`
    segmentStart = end.end
    active = undefined
    index = end.end
  }
  return output + value.slice(segmentStart)
}

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey(key)) parsed.searchParams.set(key, REDACTED)
    }
    return parsed.toString()
  } catch {
    return redactApprovalSensitiveText(value)
  }
}

function boundedText(value: string, maxBytes: number): string {
  const { end } = utf8PrefixWithinBytes(value, 0, Math.max(0, maxBytes))
  return value.slice(0, end)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isSensitiveKey(value: string): boolean {
  const normalized = value.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('password') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('privatekey')
}

export function resolveApprovalRequest(
  request: ApprovalRequest,
  decision: 'allow' | 'deny',
  reason?: string,
  decidedAt?: string
): ApprovalRequest {
  return {
    ...request,
    status: decision === 'allow' ? 'allowed' : 'denied',
    reason,
    decidedAt: decidedAt ?? new Date().toISOString()
  }
}

export function expireApprovalRequest(
  request: ApprovalRequest,
  reason?: string,
  decidedAt?: string
): ApprovalRequest {
  return {
    ...request,
    status: 'expired',
    ...(reason ? { reason } : {}),
    decidedAt: decidedAt ?? new Date().toISOString()
  }
}
