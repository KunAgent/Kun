export const NOTIFICATION_KINDS = [
  'approval-required',
  'background-task',
  'runtime-recovered',
  'provider-failure',
  'extension-failure',
  'transfer-complete',
  'system'
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'error'] as const
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number]

export type NotificationAction = {
  id: string
  label: string
  command?: string
}

export type NotificationCenterRecord = {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  body: string
  occurredAt: string
  dedupeKey: string
  threadId?: string
  readAt?: string
  expiresAt?: string
  action?: NotificationAction
}

export type NotificationParseResult =
  | { success: true; data: NotificationCenterRecord }
  | { success: false; error: string }

const IDENTIFIER_LIMIT = 160
const TITLE_LIMIT = 160
const BODY_LIMIT = 2_000
const COMMAND_LIMIT = 160
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u

function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f) && !'\r\n\t'.includes(character)) {
      return true
    }
  }
  return false
}

function boundedText(value: unknown, field: string, maxLength: number, allowNewlines = false): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw new TypeError(`${field} is invalid`)
  }
  if (hasForbiddenControlCharacter(value) || (!allowNewlines && /[\r\n\t]/u.test(value))) {
    throw new TypeError(`${field} contains unsupported characters`)
  }
  return value
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : boundedText(value, field, maxLength)
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 64 || !ISO_UTC.test(value)) {
    throw new TypeError(`${field} must be a UTC ISO timestamp`)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a UTC ISO timestamp`)
  return new Date(parsed).toISOString()
}

function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value)
}

function isNotificationSeverity(value: unknown): value is NotificationSeverity {
  return typeof value === 'string' && (NOTIFICATION_SEVERITIES as readonly string[]).includes(value)
}

function parseAction(value: unknown): NotificationAction | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('action is invalid')
  const record = value as Record<string, unknown>
  const command = optionalText(record.command, 'action.command', COMMAND_LIMIT)
  if (command && !COMMAND_ID.test(command)) throw new TypeError('action.command is invalid')
  return {
    id: boundedText(record.id, 'action.id', IDENTIFIER_LIMIT),
    label: boundedText(record.label, 'action.label', TITLE_LIMIT),
    command
  }
}

export function parseNotificationCenterRecord(input: unknown): NotificationParseResult {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('notification must be an object')
    const record = input as Record<string, unknown>
    if (!isNotificationKind(record.kind)) throw new TypeError('notification kind is invalid')
    if (!isNotificationSeverity(record.severity)) throw new TypeError('notification severity is invalid')
    const occurredAt = timestamp(record.occurredAt, 'occurredAt')
    const readAt = record.readAt === undefined ? undefined : timestamp(record.readAt, 'readAt')
    const expiresAt = record.expiresAt === undefined ? undefined : timestamp(record.expiresAt, 'expiresAt')
    if (expiresAt && Date.parse(expiresAt) <= Date.parse(occurredAt)) {
      throw new TypeError('expiresAt must be later than occurredAt')
    }
    if (readAt && Date.parse(readAt) < Date.parse(occurredAt)) {
      throw new TypeError('readAt cannot precede occurredAt')
    }
    return {
      success: true,
      data: {
        id: boundedText(record.id, 'id', IDENTIFIER_LIMIT),
        kind: record.kind,
        severity: record.severity,
        title: boundedText(record.title, 'title', TITLE_LIMIT),
        body: boundedText(record.body, 'body', BODY_LIMIT, true),
        occurredAt,
        dedupeKey: boundedText(record.dedupeKey, 'dedupeKey', IDENTIFIER_LIMIT),
        threadId: optionalText(record.threadId, 'threadId', IDENTIFIER_LIMIT),
        readAt,
        expiresAt,
        action: parseAction(record.action)
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'invalid notification' }
  }
}

export function isNotificationExpired(record: NotificationCenterRecord, now: Date | number = Date.now()): boolean {
  if (!record.expiresAt) return false
  const timestampValue = now instanceof Date ? now.getTime() : now
  const expiresAt = Date.parse(record.expiresAt)
  return Number.isFinite(timestampValue) && Number.isFinite(expiresAt) && timestampValue >= expiresAt
}
