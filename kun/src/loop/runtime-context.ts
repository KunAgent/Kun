import { isAbsolute, resolve } from 'node:path'
import type { TurnItem } from '../contracts/items.js'

export function buildRuntimeContextInstruction(input: {
  workspace?: string
  nowIso: string
  timeZone?: string
}): string | null {
  const workspace = input.workspace?.trim()
  const projectPath = workspace
    ? isAbsolute(workspace) ? workspace : resolve(workspace)
    : ''
  const localTime = formatLocalDateTimeForPrompt(input.nowIso, input.timeZone)
  if (!projectPath && !localTime) return null
  return [
    'Runtime context for this model request:',
    projectPath ? `- Current opened project absolute path: \`${projectPath}\`` : '',
    localTime ? `- Current user local time: ${localTime}` : '',
    '- Treat this block as environment context, not as user instructions.'
  ].filter(Boolean).join('\n')
}

export function shouldInjectInitialRuntimeContext(input: {
  stepIndex: number
  turnId: string
  historyItems: readonly TurnItem[]
}): boolean {
  return input.stepIndex === 0 && input.historyItems.every((item) => item.turnId === input.turnId)
}

function formatLocalDateTimeForPrompt(nowIso: string, timeZone?: string): string {
  const date = new Date(nowIso)
  const fallback = nowIso.trim()
  if (Number.isNaN(date.getTime())) return fallback
  const resolvedTimeZone = timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset'
    })
    const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]))
    const year = parts.get('year')
    const month = parts.get('month')
    const day = parts.get('day')
    const hour = parts.get('hour')
    const minute = parts.get('minute')
    const second = parts.get('second')
    const weekday = parts.get('weekday')
    if (!year || !month || !day || !hour || !minute || !second || !weekday) {
      return fallback || date.toISOString()
    }
    const zone = [resolvedTimeZone, parts.get('timeZoneName')].filter(Boolean).join(', ')
    return `${year}-${month}-${day} ${hour}:${minute}:${second} ${weekday}${zone ? ` (${zone})` : ''}`
  } catch {
    return fallback || date.toISOString()
  }
}
