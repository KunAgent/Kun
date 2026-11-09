import { z } from 'zod'
import { HOOK_PHASES, type HookInvocation, type HookResult, type ResolvedHook } from './hook-engine.js'
import { TurnClientSurfaceSchema } from '../contracts/turns.js'

/**
 * Command hook entry as written in `config.json` under the top-level
 * `hooks` key. Only command hooks are configurable from JSON; function
 * hooks are reserved for embedders that assemble the runtime in code.
 */
export const HookCommandConfigSchema = z
  .object({
    phase: z.enum(HOOK_PHASES),
    /** Glob matched against the tool name (`*` wildcard, `|` alternation). Tool phases only. */
    matcher: z.string().min(1).optional(),
    /** Exact tool-name list; matches when either this or `matcher` matches. Tool phases only. */
    toolNames: z.array(z.string().min(1)).optional(),
    /** Optional client surfaces on which this hook is active. */
    clientSurfaces: z.array(TurnClientSurfaceSchema).min(1).optional(),
    /** Shell command. Receives the invocation as JSON on stdin. */
    command: z.string().min(1),
    /** Working directory; defaults to the active workspace. */
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional()
  })
  .strict()

/**
 * Workflow hook entry: instead of a shell command, run a GUI "Create Loop"
 * workflow over the local WorkflowRuntime HTTP endpoint. Written by the GUI under
 * the same top-level `hooks` key.
 */
export const HookWorkflowConfigSchema = z
  .object({
    phase: z.enum(HOOK_PHASES),
    matcher: z.string().min(1).optional(),
    toolNames: z.array(z.string().min(1)).optional(),
    clientSurfaces: z.array(TurnClientSurfaceSchema).min(1).optional(),
    /** Workflow id to run when the phase fires. */
    workflow: z.string().min(1),
    /** observe = run only; block = deny on failure/DENY; rewrite = fold output back. */
    mode: z.enum(['observe', 'block', 'rewrite']).optional(),
    /** WorkflowRuntime base URL, e.g. http://127.0.0.1:8765 */
    baseUrl: z.string().min(1),
    secret: z.string().optional(),
    timeoutMs: z.number().int().positive().optional()
  })
  .strict()

// A command entry (has `command`) or a workflow entry (has `workflow`).
export const HooksConfigSchema = z.array(z.union([HookCommandConfigSchema, HookWorkflowConfigSchema]))

export type HookCommandConfig = z.infer<typeof HookCommandConfigSchema>
export type HookWorkflowConfig = z.infer<typeof HookWorkflowConfigSchema>
export type HooksConfig = z.infer<typeof HooksConfigSchema>

function hookWorkspace(invocation: HookInvocation): string | undefined {
  return 'context' in invocation ? invocation.context.workspace : invocation.workspace
}

/** Build the in-process `run` for a workflow hook: POST the invocation, map the result. */
function buildWorkflowHookRun(entry: HookWorkflowConfig): (invocation: HookInvocation) => Promise<HookResult | void> {
  const mode = entry.mode ?? 'observe'
  return async (invocation) => {
    let data: Record<string, unknown>
    try {
      const response = await fetch(`${entry.baseUrl}/workflow/internal/hook-run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(entry.secret ? { authorization: `Bearer ${entry.secret}` } : {})
        },
        body: JSON.stringify({
          workflow: entry.workflow,
          phase: invocation.phase,
          mode,
          payload: invocation,
          workspaceRoot: hookWorkspace(invocation)
        })
      })
      data = (await response.json()) as Record<string, unknown>
    } catch (error) {
      const message = `workflow hook error: ${error instanceof Error ? error.message : String(error)}`
      // observe/rewrite are advisory, but a block hook is an authorization
      // decision: a transport error means no verdict, so fail closed.
      if (mode === 'block') {
        return invocation.phase === 'PostToolUse'
          ? { isError: true, message }
          : { decision: 'deny', message }
      }
      return { message }
    }
    if (!data || data.skipped) return
    const output = typeof data.output === 'string' ? data.output : ''
    const message = typeof data.message === 'string' ? data.message : ''
    const failed = data.ok === false || data.status === 'error'

    if (mode === 'observe') {
      return output || message ? { message: output || message } : undefined
    }
    if (mode === 'block') {
      const deny = failed || /^\s*(deny|block|reject|false)\b/i.test(output)
      if (!deny) return
      const reason = output || message || 'Blocked by workflow hook.'
      return invocation.phase === 'PostToolUse' ? { isError: true, message: reason } : { decision: 'deny', message: reason }
    }
    // rewrite
    if (invocation.phase === 'PostToolUse') {
      const base = invocation.result.output
      const merged =
        base && typeof base === 'object'
          ? { ...(base as Record<string, unknown>), workflow_hook: output }
          : { output: base, workflow_hook: output }
      return { output: merged }
    }
    if (invocation.phase === 'UserPromptSubmit') {
      return output ? { additionalContext: output } : undefined
    }
    if (invocation.phase === 'PreToolUse') {
      try {
        const parsed = JSON.parse(output)
        if (parsed && typeof parsed === 'object') return { arguments: parsed as Record<string, unknown> }
      } catch {
        /* not JSON arguments — fall through */
      }
      return message ? { message } : undefined
    }
    return undefined
  }
}

/** Map validated config entries onto runnable hooks (command-backed or workflow-backed). */
export function resolveConfiguredHooks(config: HooksConfig | undefined): ResolvedHook[] {
  return (config ?? []).map((entry): ResolvedHook => {
    if ('workflow' in entry) {
      return {
        phase: entry.phase,
        ...(entry.matcher ? { matcher: entry.matcher } : {}),
        ...(entry.toolNames ? { toolNames: entry.toolNames } : {}),
        ...(entry.clientSurfaces ? { clientSurfaces: entry.clientSurfaces } : {}),
        ...(entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {}),
        run: buildWorkflowHookRun(entry)
      }
    }
    return {
      phase: entry.phase,
      ...(entry.matcher ? { matcher: entry.matcher } : {}),
      ...(entry.toolNames ? { toolNames: entry.toolNames } : {}),
      ...(entry.clientSurfaces ? { clientSurfaces: entry.clientSurfaces } : {}),
      ...(entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {}),
      command: entry.command,
      ...(entry.cwd ? { cwd: entry.cwd } : {})
    }
  })
}
