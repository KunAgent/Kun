import type { ModelToolSpec } from '../ports/model-client.js'
import type { TurnItem } from '../contracts/items.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import { guiPlanWorkspaceMatches } from '../shared/gui-plan.js'
import { VERIFY_CHANGES_TOOL_NAME } from '../adapters/tool/builtin-verify-tool.js'

/**
 * Plan-mode guidance. Emitted as a second system message after the
 * byte-stable prefix (see `ModelRequest.modeInstruction`) so the cached
 * prefix is untouched while the note still rides at the front. Kept as a
 * stable constant so Plan-mode turns continue to share cached bytes.
 */
export const PLAN_MODE_INSTRUCTION = [
  'You are in Plan mode.',
  'Investigate the task first using read-only tools: prefer `read`, `grep`, `find`, and `ls` to gather the facts you need.',
  'Do NOT modify project files, apply edits, run shell commands, or run mutating commands in this mode.',
  'If the request is ambiguous or hinges on a decision only the user can make, ask before planning: prefer the `user_input` tool to ask one concise round of clarifying questions (offer concrete options when there are any), then use the answer to write the plan in the same turn. If that tool is not available, end your turn with the question(s) in prose and wait for the answer. Either way, do NOT call `create_plan` until the ambiguity is resolved — a set of options the user still has to choose between is not a plan.',
  'When you understand the task well enough, call the `create_plan` tool to save a complete implementation plan as Markdown.',
  'Use `operation: "draft"` for the first plan, and `operation: "refine"` when revising an existing plan; you may call `create_plan` multiple times as the plan evolves.',
  'Write concrete, actionable steps rather than vague intentions, and structure the saved Markdown with `##` section headings (e.g. Summary, Steps, Tests, Risks).',
  'Favor the smallest plan that fully solves the task: question whether each proposed component, abstraction, dependency, config knob, or new file needs to exist at all (YAGNI), and prefer the standard library, a native platform feature, or an already-present dependency over new custom code. Do NOT trim correctness, input validation, error handling, security, or accessibility to make a plan smaller.',
  'After saving, give the user a short summary of the plan and what to review.'
].join('\n')

/** Read-only tools allowed during the investigation phase of a Plan-mode
 * turn (step 0, before `create_plan` has been called). Matches the
 * PLAN_MODE_INSTRUCTION guidance. `bash` is intentionally excluded —
 * it can execute arbitrary commands and its policy is `on-request` which
 * auto-approves under `approvalPolicy: auto`. */
const PLAN_READ_ONLY_TOOL_NAMES = new Set([
  'read',
  'ls',
  'find',
  'grep',
  'web_search',
  'web_fetch'
])

/** Interactive tools allowed during the investigation phase (step 0) of a
 * Plan-mode turn so the model can ask the user a structured clarifying
 * question (with options) and continue to `create_plan` in the same turn
 * instead of stopping with a prose question. IM/headless turns retain the
 * stable catalog but receive an instruction not to call these tools. */
const PLAN_INTERACTIVE_TOOL_NAMES = new Set(['user_input', 'request_user_input'])

/**
 * Resolve the tool list for a Plan-mode turn step. Extracted as a pure
 * function so the behaviour can be unit-tested without spinning up the
 * full agent loop.
 *
 * - Not plan-active or plan already satisfied → pass through unchanged.
 * - Step 0 (investigation): read-only + interactive (user_input) tools + create_plan.
 * - Step > 0 (must produce plan): only create_plan.
 */
export function resolvePlanModeToolSpecs(
  toolSpecs: ModelToolSpec[],
  options: {
    planTurnActive: boolean
    createPlanSatisfied: boolean
    stepIndex: number
    readOnlyToolNames?: ReadonlySet<string>
    interactiveToolNames?: ReadonlySet<string>
    planToolName?: string
  }
): ModelToolSpec[] {
  if (!options.planTurnActive || options.createPlanSatisfied) return toolSpecs
  const readOnly = options.readOnlyToolNames ?? PLAN_READ_ONLY_TOOL_NAMES
  const interactive = options.interactiveToolNames ?? PLAN_INTERACTIVE_TOOL_NAMES
  const planTool = options.planToolName ?? CREATE_PLAN_TOOL_NAME
  return options.stepIndex === 0
    ? toolSpecs.filter(
        (tool) => tool.name === planTool || readOnly.has(tool.name) || interactive.has(tool.name)
      )
    : toolSpecs.filter((tool) => tool.name === planTool)
}

// Source files a `verify_changes` run can meaningfully validate (Vitest/tsc).
// Documents and HTML written in write / design / SDD modes never match, so
// those modes are never nudged to run code verification.
const VERIFIABLE_SOURCE_PATH = /\.[cm]?[jt]sx?$/i

function fileChangeResultPath(item: TurnItem): string | null {
  if (item.kind !== 'tool_result') return null
  const output = item.output
  if (!output || typeof output !== 'object') return null
  const record = output as Record<string, unknown>
  const path = record.relative_path ?? record.path
  return typeof path === 'string' ? path : null
}

/**
 * Whether this turn changed real source files (.ts/.js family) that a later
 * `verify_changes` run has not yet covered. Only successful, non-plan
 * file-change results with a source-code path count — so writing docs or HTML
 * (write / design / SDD modes) never asks for code verification, and a denied
 * or failed edit never does either. Used only to surface an optional nudge;
 * verification is never forced.
 */
export function turnHasUnverifiedSourceChanges(
  items: readonly TurnItem[],
  turnId: string
): boolean {
  let lastSourceChangeIndex = -1
  let lastVerificationIndex = -1
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || item.turnId !== turnId || item.kind !== 'tool_result') continue
    if (item.toolName === VERIFY_CHANGES_TOOL_NAME) {
      lastVerificationIndex = index
      continue
    }
    if (
      item.toolKind === 'file_change' &&
      item.toolName !== CREATE_PLAN_TOOL_NAME &&
      item.isError !== true
    ) {
      const path = fileChangeResultPath(item)
      if (path && VERIFIABLE_SOURCE_PATH.test(path)) lastSourceChangeIndex = index
    }
  }
  return lastSourceChangeIndex >= 0 && lastSourceChangeIndex > lastVerificationIndex
}

/**
 * A soft, optional nudge to run acceptance checks after source edits. The loop
 * never forces `verify_changes` — the model decides whether validation applies.
 */
export function verificationSuggestionInstruction(): string {
  return [
    'You changed source files in this turn.',
    `If these are code changes, consider running \`${VERIFY_CHANGES_TOOL_NAME}\` to run the project's adjacent tests and typecheck before finishing.`,
    'This is optional — skip it when verification does not apply.'
  ].join(' ')
}

/**
 * A GUI plan context whose workspace doesn't match the thread it runs in is
 * stale — e.g. carried in by a conversation fork (the fork keeps the source
 * thread's workspace, but the plan context can point elsewhere). Such a context
 * must be ignored — running the turn as a normal agent turn — instead of being
 * passed to create_plan, which hard-fails on the workspace mismatch, or forcing
 * a plan-only tool set the forked history can't satisfy.
 */
export function isStalePlanContext(
  planContext: { workspaceRoot: string } | undefined,
  workspace: string
): boolean {
  return planContext ? !guiPlanWorkspaceMatches(workspace, planContext.workspaceRoot) : false
}

/**
 * Phrases that signal the assistant is asking the user to *choose* between
 * options or supply missing scope (a clarification) rather than to *approve*
 * a finished plan. Deliberately choice-oriented: a real plan that ends with a
 * generic confirmation ("sound good?", "does this work?") matches none of
 * these and is therefore still materialized rather than dropped.
 */
const PLAN_CLARIFYING_CUE =
  /\b(which|what kind|do you want|would you (?:like|prefer)|let me know which|prefer)\b|哪|还是|你想要|请选择|选项/i

/**
 * A Plan-mode turn requires `create_plan`; when the model returns prose
 * instead of calling the tool, the loop materializes that prose into the
 * plan (see runStep). But if the model is asking the user to make a
 * decision (an ambiguous request), that prose is a question, not a plan —
 * materializing it produces a useless "plan" full of unanswered options.
 * Detect that case so the turn can pause for the user instead.
 *
 * Signal (all required): no Markdown heading (a structured plan has `##`
 * sections per PLAN_MODE_INSTRUCTION), a question mark in the last couple of
 * lines, and an explicit choice/clarification cue. The cue requirement is
 * what keeps a genuine plan that merely ends with a confirmation question
 * ("Ready?", "Sound good?") from being misread as a question and dropped.
 */
export function isPlanClarifyingQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/^#{1,6}\s/m.test(trimmed)) return false
  const tail = trimmed.split('\n').slice(-2).join('\n')
  if (!/[?？]/.test(tail)) return false
  return PLAN_CLARIFYING_CUE.test(trimmed)
}
