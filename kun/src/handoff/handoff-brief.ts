import { createHash } from 'node:crypto'
import type { TurnItem } from '../contracts/items.js'
import { effectiveHistoryAfterLatestCompaction } from '../loop/compaction-history.js'
import { groupConversationTurns, type ConversationTurn } from './turn-grouping.js'
import { fitUtf8, utf8Bytes } from './utf8-budget.js'
import {
  DEFAULT_HANDOFF_BUDGETS,
  type HandoffReason,
  type HandoffStats,
  type WorkState
} from './handoff-types.js'

/**
 * Deterministic handoff brief builder (docs/ade/08 §3). Fixed templates only —
 * no timestamps, no random ids — so identical inputs produce identical bytes.
 */

export type BuildHandoffInput = {
  items: readonly TurnItem[]
  currentTurnId: string
  reason: HandoffReason
  mode: 'full' | 'delta'
  /** delta mode: only turns after this one are rendered. */
  sinceTurnId?: string
  from: { harnessName: string; model?: string }
  to: { harnessName: string; model?: string }
  workspace?: { path: string; branch?: string }
  /** Full-history work state (delta mode still shows the whole site). */
  workState: WorkState
  budgets?: Partial<import('./handoff-types.js').HandoffBudgets>
}

export type HandoffBriefResult = {
  text: string
  digest: string
  stats: HandoffStats
}

const FIELD_SNIPPET_CAP = 60
const MIN_RECENT_TEXT_CAP = 256
const RETRIEVAL_HINT =
  '## 需要更多细节时\n' +
  '用 read_thread_history 工具按关键词或轮次检索这段对话的完整原文，不要凭空推测。'

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Code-point-safe prefix: never cuts a surrogate pair in half. */
function takeChars(text: string, cap: number): string {
  return [...text].slice(0, cap).join('')
}

function snippet(text: string | undefined, cap: number): string {
  if (!text) return '—'
  const flat = singleLine(text)
  return [...flat].length > cap ? `${takeChars(flat, cap)}…` : flat
}

function verbatim(text: string, cap: number): string {
  const trimmed = text.trim()
  return [...trimmed].length > cap ? `${takeChars(trimmed, cap)}…（已截断）` : trimmed
}

function renderHeader(input: BuildHandoffInput, deltaApplied: boolean): string {
  const lines = [`<kun_handoff version="1" reason="${input.reason}">`]
  const from = input.from.model
    ? `${input.from.harnessName}（${input.from.model}）`
    : input.from.harnessName
  const to = input.to.model
    ? `${input.to.harnessName}（${input.to.model}）`
    : input.to.harnessName
  lines.push(`来源：${from}→ 接手：${to}`)
  if (input.workspace) {
    lines.push(
      input.workspace.branch
        ? `工作区：${input.workspace.path}（分支 ${input.workspace.branch}）`
        : `工作区：${input.workspace.path}`
    )
  }
  if (deltaApplied) lines.push('你离开期间发生了：')
  return lines.join('\n')
}

function digestLine(turn: ConversationTurn, lineCap: number): string {
  const line =
    `- 第 ${turn.turnNumber} 轮 用户：${snippet(turn.userText, FIELD_SNIPPET_CAP)}` +
    ` ／ 助手：${snippet(turn.assistantText, FIELD_SNIPPET_CAP)}`
  return [...line].length > lineCap ? `${takeChars(line, Math.max(0, lineCap - 1))}…` : line
}

function renderDigest(
  summaryText: string | undefined,
  lines: readonly string[]
): string {
  if (!summaryText && lines.length === 0) return ''
  const parts = ['## 较早的对话（摘要）']
  if (summaryText) parts.push(summaryText)
  parts.push(...lines)
  return parts.join('\n')
}

function renderRecent(turns: readonly ConversationTurn[], textCap: number): string {
  if (turns.length === 0) return ''
  const parts = ['## 最近的对话（原文）']
  for (const turn of turns) {
    if (turn.userText) {
      parts.push(`### 第 ${turn.turnNumber} 轮 用户`, verbatim(turn.userText, textCap))
    }
    if (turn.assistantText) {
      parts.push(`### 第 ${turn.turnNumber} 轮 助手`, verbatim(turn.assistantText, textCap))
    }
  }
  return parts.length > 1 ? parts.join('\n') : ''
}

function renderWorkState(workState: WorkState, commandLimit: number): string {
  const parts = ['## 工作现场']
  parts.push(
    workState.files.length > 0
      ? `改动过的文件：${workState.files.join('，')}（共 ${workState.files.length} 个）`
      : '改动过的文件：（无）'
  )
  const commands = workState.commands.slice(-commandLimit)
  if (commands.length > 0) {
    parts.push(`执行过的命令（最近 ${commands.length} 条）：`)
    for (const entry of commands) {
      parts.push(
        entry.exitCode === undefined
          ? `- ${singleLine(entry.command)}`
          : `- ${singleLine(entry.command)}  → 退出码 ${entry.exitCode}`
      )
    }
  }
  if (workState.todos.length > 0) {
    parts.push(`未完成的待办：${workState.todos.map(singleLine).join('；')}`)
  }
  if (workState.goal) parts.push(`当前目标：${singleLine(workState.goal)}`)
  if (workState.plan) parts.push(`计划文件：${workState.plan}`)
  return parts.join('\n')
}

export function buildHandoffBrief(input: BuildHandoffInput): HandoffBriefResult {
  const budgets = { ...DEFAULT_HANDOFF_BUDGETS, ...input.budgets }
  const effective = effectiveHistoryAfterLatestCompaction(input.items)
  const summary =
    effective[0]?.kind === 'compaction' && effective[0].replacedTokens > 0
      ? effective[0]
      : undefined
  const effectiveTurnIds = new Set(effective.map((item) => item.turnId))
  let turns = groupConversationTurns(input.items, input.currentTurnId)
    .filter((turn) => effectiveTurnIds.has(turn.turnId))
  let deltaApplied = false
  if (input.mode === 'delta' && input.sinceTurnId) {
    const index = turns.findIndex((turn) => turn.turnId === input.sinceTurnId)
    // An unknown anchor degenerates to a full brief rather than losing turns.
    if (index >= 0) {
      turns = turns.slice(index + 1)
      deltaApplied = true
    }
  }

  const header = renderHeader(input, deltaApplied)
  const workState = renderWorkState(input.workState, budgets.commandLimit)
  const footer = `${RETRIEVAL_HINT}\n</kun_handoff>`
  const summaryText = summary?.summary.trim() || undefined
  const digestPool = (count: number): string[] => {
    const older = turns.slice(0, Math.max(0, turns.length - count))
    const lines: string[] = []
    let used = summaryText ? summaryText.length + 1 : 0
    // Newest lines win the digest budget; oldest drop first.
    for (const turn of older.reverse()) {
      const line = digestLine(turn, budgets.digestLineCap)
      if (used + line.length + 1 > budgets.digestBudget) break
      lines.unshift(line)
      used += line.length + 1
    }
    return lines
  }

  let recentCount = Math.min(budgets.recentTurns, turns.length)
  let textCap = budgets.recentTextCap
  let digestLines = digestPool(recentCount)

  const assemble = (): string =>
    [
      header,
      renderDigest(summaryText, digestLines),
      renderRecent(turns.slice(-recentCount), textCap),
      workState,
      footer
    ].filter((section) => section.length > 0).join('\n\n')

  let text = assemble()
  // Fit order (08 §3.2): drop oldest digest lines → shrink the per-message
  // cap → drop verbatim turns (min 1) → hard-truncate as a last resort. The
  // work-state and footer sections are never reduced.
  while (utf8Bytes(text) > budgets.totalCap) {
    if (digestLines.length > 0) {
      digestLines = digestLines.slice(1)
    } else if (textCap > MIN_RECENT_TEXT_CAP) {
      textCap = Math.max(MIN_RECENT_TEXT_CAP, Math.floor(textCap * 0.75))
    } else if (recentCount > 1) {
      recentCount -= 1
      digestLines = digestLines.length > 0 ? digestLines : digestPool(recentCount)
    } else {
      text = fitUtf8(text, budgets.totalCap)
      break
    }
    text = assemble()
  }

  return {
    text,
    digest: createHash('sha256').update(text, 'utf8').digest('hex'),
    stats: {
      recentTurns: recentCount,
      digestLines: digestLines.length,
      files: input.workState.files.length,
      commands: Math.min(input.workState.commands.length, budgets.commandLimit),
      bytes: utf8Bytes(text)
    }
  }
}
