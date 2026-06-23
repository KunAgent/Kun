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

// Guard against providers that over-report prompt_tokens by folding cumulative
// cache reads into the per-request count. MiniMax-M3 was observed reporting
// ~1.2M prompt tokens for a thread whose real content was ~33k (its reported
// cache-hit tokens alone exceeded the entire conversation, which is impossible),
// pinning this gauge at 100%. When the measured total dwarfs our own estimate of
// the whole prompt by more than this factor, treat it as unreliable and fall
// back to the estimate. Wide enough to absorb honest under-counting (images,
// formatting) while still catching order-of-magnitude inflation.
export const PROMPT_TOKEN_TRUST_FACTOR = 6

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

// A screenshot or embedded image is forwarded to the model as a bounded vision
// payload, not as its raw base64 text — the runtime strips the base64 at
// send-time and charges a flat per-image cost (see kun tool-result-image.ts).
// A tool result's `detail` here is JSON.stringify(output), which still carries
// the raw base64 (often hundreds of thousands of characters). Tokenizing that
// as text would read a single screenshot as ~100k+ tokens and peg the gauge at
// 100% after one computer_use turn, so we mirror the runtime and discount it.
const FLAT_IMAGE_TOKENS = 1200
// A contiguous run of base64-alphabet characters this long is an encoded image
// or binary blob, never prose — real text breaks on whitespace/punctuation long
// before this. Pretty-printed JSON keeps each base64 value on one line.
const BASE64_RUN_RE = /[A-Za-z0-9+/]{1000,}={0,2}/g

/**
 * Estimate tokens for a tool/compaction `detail` string while discounting
 * embedded base64 image/binary payloads to a flat per-image cost. Never
 * inflates a false-positive match: each run is charged the *lesser* of its raw
 * text estimate and the flat image cost, so non-image content is unaffected.
 */
function estimateDetailTokens(detail: string): number {
  if (!detail) return 0
  let imageTokens = 0
  const stripped = detail.replace(BASE64_RUN_RE, (run) => {
    imageTokens += Math.min(estimateTokensFromText(run), FLAT_IMAGE_TOKENS)
    return ''
  })
  return estimateTokensFromText(stripped) + imageTokens
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
      return estimateTokensFromText(block.text ?? '') + estimateDetailTokens(block.detail ?? '')
    case 'tool':
      return estimateDetailTokens(block.detail ?? '')
    case 'compaction':
      // After compaction the runtime drops the folded history and re-sends the
      // `summary` as a system message — that summary IS the post-compaction
      // conversation, so it is what occupies the window. `detail` is only the
      // short pinned-constraints line; counting it alone collapses the whole
      // conversation to a handful of tokens (the "消息: 7" surprise).
      return estimateDetailTokens(block.summary ?? '')
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

  // The measured prompt-token total is the source of truth only while it stays
  // within a sane multiple of what we estimate the whole prompt to be. Beyond
  // that it is a provider accounting artifact (see PROMPT_TOKEN_TRUST_FACTOR);
  // fall back to the estimate so the gauge reflects the real, much smaller
  // context rather than being stranded at 100%.
  const localEstimate = messageEstimate + prefixEstimate
  const measuredTotal =
    typeof input.lastTurnInputTokens === 'number' && input.lastTurnInputTokens > 0
      ? input.lastTurnInputTokens
      : 0
  const hasMeasuredTotal =
    measuredTotal > 0 && measuredTotal <= localEstimate * PROMPT_TOKEN_TRUST_FACTOR

  let tools: number
  let system: number
  let skills: number
  let other: number
  let messages: number
  let usedTokens: number

  if (hasMeasuredTotal) {
    // Real total from the latest provider count, with a live local floor. While
    // an assistant reply is streaming, the provider count can still describe
    // the request that started the turn, but the partial reply is already
    // visible future context. Let the estimate raise the total until the next
    // provider usage event calibrates it again.
    usedTokens = clamp(Math.round(Math.max(measuredTotal, localEstimate)), 0, windowTokens)
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
