import type { ToolBlock } from '../../agent/types'
import { parseDelegateDetail } from './subagent-call-card-support'

const BARE_TOOL_NAMES = /^(delegate_task|fast_context|explore_agent|generate_subagent)$/i

export function isBareSubagentToolName(text: string | undefined | null): boolean {
  const value = text?.trim() ?? ''
  if (!value) return true
  return BARE_TOOL_NAMES.test(value)
}

function readDetailString(detail: string | undefined, key: string): string | undefined {
  if (!detail?.trim()) return undefined
  try {
    const parsed = JSON.parse(detail) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const value = (parsed as Record<string, unknown>)[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

export function isFastContextToolBlock(block: ToolBlock): boolean {
  const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName.trim() : ''
  if (toolName === 'fast_context' || toolName === 'explore_agent') return true
  if (readDetailString(block.detail, 'profile') === 'explore') return true
  const child = block.meta?.child
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    const profile = (child as { childProfile?: unknown }).childProfile
    if (typeof profile === 'string' && profile.trim() === 'explore') return true
  }
  return false
}

export function firstUsefulLine(text: string | undefined, max = 48): string | undefined {
  if (!text?.trim()) return undefined
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine || isBareSubagentToolName(oneLine)) return undefined
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

export function resolveFastContextTaskTitle(input: {
  childLabel?: string
  title?: string
  query?: string
  summary?: string
  blockSummary?: string
  fallback: string
}): string {
  const candidates = [
    input.childLabel,
    input.title,
    input.query,
    input.summary,
    input.blockSummary
  ]
  for (const candidate of candidates) {
    const line = firstUsefulLine(candidate, 48)
    if (line) return line
  }
  return input.fallback
}

/** Best-effort task one-liner from a generic delegate/explore summary string. */
export function splitTaskLine(block: ToolBlock): string | undefined {
  const detail = parseDelegateDetail(block.detail)
  if (detail.title?.trim()) return detail.title.trim()
  const raw = block.summary?.trim()
  if (!raw) return undefined
  const stripped = raw
    .replace(/^(delegate_task|fast_context|explore_agent|generate_subagent)\s*:\s*/i, '')
    .trim()
  if (!stripped || stripped.length > 160) return undefined
  // Bare tool name (no task text yet, e.g. while running) — nothing useful.
  if (/^(delegate_task|fast_context|explore_agent|generate_subagent)$/i.test(stripped)) return undefined
  return stripped
}
