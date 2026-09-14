import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import type { ToolCallLike, ToolHostContext } from '../ports/tool-host.js'
import { shellSpawnEnv } from '../adapters/tool/builtin-tool-utils.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import { normalizeRawToolArgumentsEnvelope } from '../domain/tool-argument-envelope.js'

/**
 * Hook phases. Tool phases run inside the tool host around every tool
 * call; lifecycle phases run inside the agent loop. `UserPromptSubmit`
 * may deny the turn or inject extra context; `TurnStart`, `TurnEnd`,
 * and `PreCompact` are observe-only.
 */
export const HOOK_PHASES = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'TurnStart',
  'TurnEnd',
  'PreCompact'
] as const

export type HookPhase = (typeof HOOK_PHASES)[number]

export type ToolHookContext = Pick<
  ToolHostContext,
  | 'threadId'
  | 'turnId'
  | 'workspace'
  | 'threadMode'
  | 'approvalPolicy'
  | 'sandboxMode'
  | 'clientSurface'
>

export type ToolHookResultPayload = {
  output: unknown
  isError?: boolean
}

export type HookInvocation =
  | { phase: 'PreToolUse'; call: ToolCallLike; context: ToolHookContext }
  | { phase: 'PostToolUse'; call: ToolCallLike; context: ToolHookContext; result: ToolHookResultPayload }
  | {
      phase: 'UserPromptSubmit'
      threadId: string
      turnId: string
      prompt: string
      workspace?: string
      clientSurface?: TurnClientSurface
    }
  | {
      phase: 'TurnStart'
      threadId: string
      turnId: string
      prompt: string
      workspace?: string
      clientSurface?: TurnClientSurface
    }
  | {
      phase: 'TurnEnd'
      threadId: string
      turnId: string
      status: 'completed' | 'failed' | 'aborted'
      error?: string
      workspace?: string
      clientSurface?: TurnClientSurface
    }
  | {
      phase: 'PreCompact'
      threadId: string
      turnId: string
      reason: string
      mode?: string
      workspace?: string
      clientSurface?: TurnClientSurface
    }

export type HookResult = {
  /**
   * `deny` blocks the action (tool call or turn) with `message` as the
   * reason. `allow` on PreToolUse additionally skips approval prompting
   * for this call. Later hooks can still deny an earlier allow.
   */
  decision?: 'allow' | 'deny'
  message?: string
  /** PreToolUse only: replaces the tool arguments for subsequent hooks and execution. */
  arguments?: Record<string, unknown>
  /** PostToolUse only: replaces the tool output for subsequent hooks and the model. */
  output?: unknown
  isError?: boolean
  /** UserPromptSubmit only: extra context appended to the turn as a persisted message. */
  additionalContext?: string
}

/**
 * A hook ready to run. Function hooks (`run`) are for embedders that
 * assemble the runtime programmatically. Command hooks (`command`) are
 * what `config.json` resolves to: the invocation is written to stdin as
 * JSON and the result is read from stdout (see `runCommandHook`).
 */
export type ResolvedHook =
  | {
      phase: HookPhase
      /** Glob pattern matched against the tool name: `*` wildcard, `|` alternation. */
      matcher?: string
      /** Exact tool-name allow-list. Matches when either this or `matcher` matches. */
      toolNames?: readonly string[]
      /** Optional client-surface scope. Omitted means every client surface. */
      clientSurfaces?: readonly TurnClientSurface[]
      timeoutMs?: number
      run: (invocation: HookInvocation) => Promise<HookResult | void> | HookResult | void
    }
  | {
      phase: HookPhase
      matcher?: string
      toolNames?: readonly string[]
      clientSurfaces?: readonly TurnClientSurface[]
      timeoutMs?: number
      command: string
      cwd?: string
    }

export const DEFAULT_HOOK_TIMEOUT_MS = 60_000

/** Exit code a command hook uses to block the action (deny / mark error). */
export const HOOK_BLOCKING_EXIT_CODE = 2

export type PreToolUseOutcome = {
  call: ToolCallLike
  denied?: string
  /** True when a hook returned `decision: 'allow'` and nothing denied: skips approval. */
  autoApproved: boolean
  warnings: string[]
}

export type PostToolUseOutcome = {
  output: unknown
  isError?: boolean
  warnings: string[]
}

export type UserPromptSubmitOutcome = {
  denied?: string
  additionalContext: string[]
  warnings: string[]
}

export type ObserverOutcome = {
  warnings: string[]
}

export function hasHooksForPhase(hooks: readonly ResolvedHook[] | undefined, phase: HookPhase): boolean {
  return (hooks ?? []).some((hook) => hook.phase === phase)
}

/**
 * Run PreToolUse hooks in order. Argument rewrites chain: each hook
 * sees the call as rewritten by the hooks before it. A deny stops the
 * chain. Hook crashes and timeouts propagate to the caller, which
 * contains them as a `hook_failed` tool error.
 */
export async function runPreToolUseHooks(
  hooks: readonly ResolvedHook[] | undefined,
  input: { call: ToolCallLike; context: ToolHookContext }
): Promise<PreToolUseOutcome> {
  let call = normalizeToolCallArguments(input.call)
  let autoApproved = false
  const warnings: string[] = []
  for (const hook of hooksForTool(hooks, 'PreToolUse', call.toolName)) {
    const outcome = await executeHook(hook, { phase: 'PreToolUse', call, context: input.context })
    if (outcome.warning) warnings.push(outcome.warning)
    const result = outcome.result
    if (!result) continue
    if (result.decision === 'deny') {
      return {
        call,
        denied: result.message || 'tool call denied by PreToolUse hook',
        autoApproved: false,
        warnings
      }
    }
    if (result.decision === 'allow') autoApproved = true
    if (result.arguments && typeof result.arguments === 'object') {
      call = normalizeToolCallArguments({ ...call, arguments: result.arguments })
    }
  }
  return { call, autoApproved, warnings }
}

function normalizeToolCallArguments(call: ToolCallLike): ToolCallLike {
  const normalized = normalizeRawToolArgumentsEnvelope(call.arguments)
  return normalized === call.arguments ? call : { ...call, arguments: normalized }
}

/**
 * Run PostToolUse hooks in order. Output rewrites chain: each hook sees
 * the result as rewritten by the hooks before it.
 */
export async function runPostToolUseHooks(
  hooks: readonly ResolvedHook[] | undefined,
  input: { call: ToolCallLike; context: ToolHookContext; result: ToolHookResultPayload }
): Promise<PostToolUseOutcome> {
  let current = input.result
  const warnings: string[] = []
  for (const hook of hooksForTool(hooks, 'PostToolUse', input.call.toolName)) {
    const outcome = await executeHook(hook, {
      phase: 'PostToolUse',
      call: input.call,
      context: input.context,
      result: current
    })
    if (outcome.warning) warnings.push(outcome.warning)
    const result = outcome.result
    if (!result) continue
    if ('output' in result) {
      current = { output: result.output, isError: result.isError ?? current.isError }
    } else if (result.isError !== undefined) {
      current = { ...current, isError: result.isError }
    }
  }
  return { output: current.output, isError: current.isError, warnings }
}

/**
 * Run UserPromptSubmit hooks. A deny fails the turn before the first
 * model call. `additionalContext` strings are collected for the loop to
 * persist as extra turn context. Hook crashes fail open with a warning:
 * a broken gate must not lock the user out of their own agent.
 */
export async function runUserPromptSubmitHooks(
  hooks: readonly ResolvedHook[] | undefined,
  input: {
    threadId: string
    turnId: string
    prompt: string
    workspace?: string
    clientSurface?: TurnClientSurface
  }
): Promise<UserPromptSubmitOutcome> {
  const additionalContext: string[] = []
  const warnings: string[] = []
  for (const hook of hooksForPhase(hooks, 'UserPromptSubmit')) {
    let outcome: HookExecutionOutcome
    try {
      outcome = await executeHook(hook, { phase: 'UserPromptSubmit', ...input })
    } catch (error) {
      warnings.push(`UserPromptSubmit hook failed: ${errorMessage(error)}`)
      continue
    }
    if (outcome.warning) warnings.push(outcome.warning)
    const result = outcome.result
    if (!result) continue
    if (result.decision === 'deny') {
      return {
        denied: result.message || 'turn denied by UserPromptSubmit hook',
        additionalContext,
        warnings
      }
    }
    if (result.additionalContext?.trim()) additionalContext.push(result.additionalContext.trim())
    if (result.message?.trim() && !result.additionalContext) warnings.push(result.message.trim())
  }
  return { additionalContext, warnings }
}

/**
 * Run observe-only hooks (TurnStart, TurnEnd, PreCompact). Results are
 * ignored except messages; crashes and timeouts become warnings.
 */
export async function runObserverHooks(
  hooks: readonly ResolvedHook[] | undefined,
  invocation: Extract<HookInvocation, { phase: 'TurnStart' | 'TurnEnd' | 'PreCompact' }>
): Promise<ObserverOutcome> {
  const warnings: string[] = []
  for (const hook of hooksForPhase(hooks, invocation.phase)) {
    try {
      const outcome = await executeHook(hook, invocation)
      if (outcome.warning) warnings.push(outcome.warning)
      else if (outcome.result?.message?.trim()) warnings.push(outcome.result.message.trim())
    } catch (error) {
      warnings.push(`${invocation.phase} hook failed: ${errorMessage(error)}`)
    }
  }
  return { warnings }
}

function hooksForPhase(hooks: readonly ResolvedHook[] | undefined, phase: HookPhase): ResolvedHook[] {
  return (hooks ?? []).filter((hook) => hook.phase === phase)
}

function hooksForTool(
  hooks: readonly ResolvedHook[] | undefined,
  phase: HookPhase,
  toolName: string
): ResolvedHook[] {
  return hooksForPhase(hooks, phase).filter((hook) => hookMatchesTool(hook, toolName))
}

export function hookMatchesTool(
  hook: Pick<ResolvedHook, 'matcher' | 'toolNames'>,
  toolName: string
): boolean {
  const hasNames = Boolean(hook.toolNames && hook.toolNames.length > 0)
  const hasMatcher = Boolean(hook.matcher)
  if (!hasNames && !hasMatcher) return true
  if (hasNames && hook.toolNames!.includes(toolName)) return true
  if (hasMatcher && compileMatcher(hook.matcher!).test(toolName)) return true
  return false
}

export const MAX_HOOK_MATCHER_CACHE_ENTRIES = 256
const matcherCache = new Map<string, RegExp>()

export const hookMatcherCacheForTesting = {
  clear: (): void => matcherCache.clear(),
  size: (): number => matcherCache.size
}

/** Compile a glob matcher: `*` matches any run of characters, `|` separates alternatives. */
function compileMatcher(pattern: string): RegExp {
  const cached = matcherCache.get(pattern)
  if (cached) {
    matcherCache.delete(pattern)
    matcherCache.set(pattern, cached)
    return cached
  }
  const alternatives = pattern
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[.+?^${}()[\]\\]/g, '\\$&').replaceAll('*', '.*'))
  const regex = new RegExp(`^(?:${alternatives.join('|') || '$.'})$`)
  matcherCache.set(pattern, regex)
  while (matcherCache.size > MAX_HOOK_MATCHER_CACHE_ENTRIES) {
    const oldest = matcherCache.keys().next().value
    if (oldest === undefined) break
    matcherCache.delete(oldest)
  }
  return regex
}

type HookExecutionOutcome = {
  result?: HookResult
  /** Non-blocking diagnostic (command hook exited non-zero without blocking). */
  warning?: string
}

async function executeHook(hook: ResolvedHook, invocation: HookInvocation): Promise<HookExecutionOutcome> {
  const surface = clientSurfaceOf(invocation)
  if (hook.clientSurfaces?.length && (!surface || !hook.clientSurfaces.includes(surface))) {
    return {}
  }
  if ('run' in hook) {
    const result = await withTimeout(
      Promise.resolve(hook.run(invocation)),
      hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      `${hook.phase} hook timed out`
    )
    return result ? { result } : {}
  }
  return runCommandHook(hook, invocation)
}

function clientSurfaceOf(invocation: HookInvocation): TurnClientSurface | undefined {
  if (invocation.phase === 'PreToolUse' || invocation.phase === 'PostToolUse') {
    return invocation.context.clientSurface
  }
  return invocation.clientSurface
}

/**
 * Command hook protocol:
 * - The invocation is written to stdin as a single JSON document.
 * - Exit 0: stdout is parsed as a JSON `HookResult`. Plain (non-JSON)
 *   stdout becomes `additionalContext` for UserPromptSubmit and
 *   `message` for every other phase.
 * - Exit 2: blocks. PreToolUse/UserPromptSubmit deny, PostToolUse marks
 *   the result as an error; stderr is the reason.
 * - Any other exit code: non-blocking warning with stderr attached.
 * - Timeout kills the spawned process tree and propagates as an error.
 */
async function runCommandHook(
  hook: Extract<ResolvedHook, { command: string }>,
  invocation: HookInvocation
): Promise<HookExecutionOutcome> {
  const payload = JSON.stringify(invocation)
  const child = await spawnOwnedProcess(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    process.platform === 'win32' ? ['/d', '/s', '/c', hook.command] : ['-c', hook.command], {
    cwd: hook.cwd || workspaceOf(invocation) || undefined,
    env: shellSpawnEnv(),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdin?.end(payload)
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const exitCode = await withTimeout(
    new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0))
    }),
    hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    `${hook.phase} command hook timed out`
  ).catch(async (error) => {
    await stopOwnedProcess(child)
    throw error
  })
  if (exitCode === HOOK_BLOCKING_EXIT_CODE) {
    const reason = stderr.trim() || `${hook.phase} command hook blocked (exit ${exitCode})`
    if (invocation.phase === 'PostToolUse') {
      return { result: { isError: true, message: reason } }
    }
    return { result: { decision: 'deny', message: reason } }
  }
  if (exitCode !== 0) {
    return {
      warning: stderr.trim() || `${hook.phase} command hook exited with ${exitCode}`
    }
  }
  const text = stdout.trim()
  if (!text) return {}
  try {
    return { result: JSON.parse(text) as HookResult }
  } catch {
    if (invocation.phase === 'UserPromptSubmit') {
      return { result: { additionalContext: text } }
    }
    return { result: { message: text } }
  }
}

function workspaceOf(invocation: HookInvocation): string | undefined {
  if (invocation.phase === 'PreToolUse' || invocation.phase === 'PostToolUse') {
    return invocation.context.workspace
  }
  return invocation.workspace
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs))
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
