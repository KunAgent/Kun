import type { ToolBlock } from '../../agent/types'

const BACKGROUND_SHELL_ACTION_LABEL_KEYS: Record<string, string> = {
  list: 'toolActionBackgroundShellList',
  read: 'toolActionBackgroundShellRead',
  poll: 'toolActionBackgroundShellPoll',
  write: 'toolActionBackgroundShellWrite',
  stop: 'toolActionBackgroundShellStop'
}

function truncateSummaryText(text: string, max = 72): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1).trimEnd()}…`
}

function readPayloadString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseToolBlockPayload(block: ToolBlock): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(block.meta ?? {}) }
  const detail = block.detail?.trim()
  if (!detail?.startsWith('{')) return merged
  try {
    const parsed = JSON.parse(detail) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return merged
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!(key in merged)) merged[key] = value
    }
  } catch {
    // Ignore invalid JSON tool payloads in the timeline summary.
  }
  return merged
}

export function summarizeBackgroundShellToolBlock(
  block: ToolBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const payload = parseToolBlockPayload(block)
  const action = readPayloadString(payload, 'action') ?? ''
  const sessionId = readPayloadString(payload, 'session_id') ?? ''
  const command = readPayloadString(payload, 'command') ?? ''
  const actionLabelKey = BACKGROUND_SHELL_ACTION_LABEL_KEYS[action]
  const actionLabel = actionLabelKey ? t(actionLabelKey) : action

  if (action === 'list') {
    const parts = [actionLabel || t('toolBuiltinBackgroundShell', { defaultValue: 'Background shell' })]
    if (payload.include_finished === true) {
      parts.push(t('toolActionBackgroundShellIncludeFinished', { defaultValue: 'include finished' }))
    }
    return parts.join(' · ')
  }

  const parts: string[] = []
  if (actionLabel) parts.push(actionLabel)
  if (sessionId) parts.push(sessionId)
  if (command) parts.push(truncateSummaryText(command))
  if (parts.length > 0) return parts.join(' ')
  return t('toolBuiltinBackgroundShell', { defaultValue: 'Background shell' })
}

export function readNumber(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!meta) return undefined
  const v = meta[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function isBackgroundShellCommandBlock(block: ToolBlock): boolean {
  const sessionId = block.meta?.session_id
  return typeof sessionId === 'string' && /^[a-z0-9]{8}$/i.test(sessionId.trim())
}

export function formatToolTitle(block: ToolBlock, t: (key: string) => string): string {
  if (block.toolKind === 'file_change') return t('toolActionFile')
  if (block.toolKind === 'command_execution') {
    return isBackgroundShellCommandBlock(block) ? t('toolActionBackgroundCommand') : t('toolActionCommand')
  }
  return t('toolActionTool')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  if (ms < 3_600_000) {
    const totalSeconds = Math.round(ms / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}m ${s}s`
  }
  if (ms < 86_400_000) {
    const totalMinutes = Math.round(ms / 60_000)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${h}h ${m}m`
  }
  const totalHours = Math.round(ms / 3_600_000)
  const d = Math.floor(totalHours / 24)
  const h = totalHours % 24
  return `${d}d ${h}h`
}
