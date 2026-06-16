import type { ChatBlock } from '../agent/types'

/**
 * Context-window capacity model for the composer "上下文容量" popover.
 *
 * The total occupancy is taken from the most recent turn's real prompt-token
 * count when available (each turn re-sends the whole context, so the last
 * `promptTokens` ≈ what currently sits in the window). The per-category split
 * is estimated: the conversation is estimated from the message text we hold in
 * the renderer, and the stable prefix (tools / system prompt / skills / other)
 * is split proportionally so the parts always add up to the real total. When no
 * live turn has happened yet we fall back to a pure estimate.
 *
 * Everything is expressed as a share of the window, so the categories plus the
 * free row always sum to 100% — that is the invariant the old display broke.
 */

export type ContextCategoryKey = 'tools' | 'system' | 'skills' | 'messages' | 'other'

export type ContextCategory = {
  key: ContextCategoryKey
  tokens: number
  /** Share of the whole window, 0..1. */
  ratio: number
}

export type ContextCapacity = {
  windowTokens: number
  usedTokens: number
  freeTokens: number
  /** Used share of the window, 0..1. */
  usedRatio: number
  /** Free share of the window, 0..1. */
  freeRatio: number
  categories: ContextCategory[]
  /** True when the breakdown (not necessarily the total) is estimated. */
  estimated: boolean
  /** True when the total occupancy is a real measurement, not an estimate. */
  hasMeasuredTotal: boolean
}

export type ContextCapacityInput = {
  windowTokens: number
  /** Real prompt tokens from the latest turn, or null when none yet. */
  lastTurnInputTokens: number | null
  /**
   * Estimated tokens for the conversation portion. Pre-computed by the caller
   * (with per-block caching) so this function stays O(1) and never re-scans
   * message text on every recompute.
   */
  messageTokens: number
  /** Number of tool definitions advertised to the model. */
  toolCount: number
  /** Number of skills in the always-injected catalog. */
  skillCount: number
}

// Rough per-item weights. These only set the *ratio* between prefix categories
// (the absolute scale is pinned to the real total), so they don't need to be
// exact — just plausible relative sizes.
export const BUILTIN_TOOL_COUNT = 14
export const TOKENS_PER_TOOL = 90
export const TOKENS_PER_SKILL = 45
export const SYSTEM_PROMPT_BASE_TOKENS = 1600
export const OTHER_BASE_TOKENS = 220

const CJK_TOKENS_PER_CHAR = 0.9
const ASCII_CHARS_PER_TOKEN = 4

// All ranges are in the Basic Multilingual Plane, so a UTF-16 code unit equals
// the code point here — an indexed charCodeAt loop is both correct and fast.
function isCjkCodeUnit(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) // CJK Compatibility Ideographs
  )
}

/**
 * Cheap token estimate that treats CJK characters (~1 token each) differently
 * from latin text (~4 chars per token). Good enough for a usage gauge. Uses an
 * indexed loop (no iterator allocation) so it stays fast on long messages.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0
  const len = text.length
  let cjk = 0
  for (let i = 0; i < len; i += 1) {
    if (isCjkCodeUnit(text.charCodeAt(i))) cjk += 1
  }
  const ascii = len - cjk
  return Math.ceil(cjk * CJK_TOKENS_PER_CHAR + ascii / ASCII_CHARS_PER_TOKEN)
}

/**
 * Estimate the model-visible tokens for a single block. Cheap and pure so the
 * caller can memoize per block (block identity is stable across streaming
 * updates, so unchanged history is never re-scanned).
 */
export function estimateBlockTokens(block: ChatBlock): number {
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
      return estimateTokensFromText(block.text ?? '')
    case 'system':
      return estimateTokensFromText(block.text ?? '') + estimateTokensFromText(block.detail ?? '')
    case 'tool':
    case 'compaction':
      return estimateTokensFromText(block.detail ?? '')
    default:
      return 0
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function buildContextCapacity(input: ContextCapacityInput): ContextCapacity {
  const windowTokens = Math.max(1, Math.round(input.windowTokens))

  const messageEstimate = Math.max(0, input.messageTokens)
  const toolsEstimate = Math.max(0, BUILTIN_TOOL_COUNT + input.toolCount) * TOKENS_PER_TOOL
  const skillsEstimate = Math.max(0, input.skillCount) * TOKENS_PER_SKILL
  const systemEstimate = SYSTEM_PROMPT_BASE_TOKENS
  const otherEstimate = OTHER_BASE_TOKENS
  const prefixEstimate = toolsEstimate + skillsEstimate + systemEstimate + otherEstimate

  const hasMeasuredTotal =
    typeof input.lastTurnInputTokens === 'number' && input.lastTurnInputTokens > 0

  let tools: number
  let system: number
  let skills: number
  let other: number
  let messages: number
  let usedTokens: number

  if (hasMeasuredTotal) {
    // Real total; estimate the breakdown but scale the prefix so the parts add
    // up to the measured occupancy exactly.
    usedTokens = clamp(Math.round(input.lastTurnInputTokens as number), 0, windowTokens)
    messages = clamp(messageEstimate, 0, usedTokens)
    const prefixActual = Math.max(0, usedTokens - messages)
    const scale = prefixEstimate > 0 ? prefixActual / prefixEstimate : 0
    tools = toolsEstimate * scale
    system = systemEstimate * scale
    skills = skillsEstimate * scale
    other = otherEstimate * scale
  } else {
    // No turn yet — pure estimate, scaled down if it would overflow the window.
    const rawUsed = prefixEstimate + messageEstimate
    const scale = rawUsed > windowTokens ? windowTokens / rawUsed : 1
    tools = toolsEstimate * scale
    system = systemEstimate * scale
    skills = skillsEstimate * scale
    other = otherEstimate * scale
    messages = messageEstimate * scale
    usedTokens = clamp(Math.round(rawUsed), 0, windowTokens)
  }

  const categories: ContextCategory[] = [
    { key: 'tools', tokens: Math.round(tools), ratio: tools / windowTokens },
    { key: 'system', tokens: Math.round(system), ratio: system / windowTokens },
    { key: 'skills', tokens: Math.round(skills), ratio: skills / windowTokens },
    { key: 'messages', tokens: Math.round(messages), ratio: messages / windowTokens },
    { key: 'other', tokens: Math.round(other), ratio: other / windowTokens }
  ]

  const freeTokens = Math.max(0, windowTokens - usedTokens)

  return {
    windowTokens,
    usedTokens,
    freeTokens,
    usedRatio: usedTokens / windowTokens,
    freeRatio: freeTokens / windowTokens,
    categories,
    estimated: true,
    hasMeasuredTotal
  }
}
