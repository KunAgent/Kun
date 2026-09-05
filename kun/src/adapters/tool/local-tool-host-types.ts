import type { ToolCallLike, ToolEffects, ToolExecutionUpdate, ToolHostContext } from '../../ports/tool-host.js'
import type { ResolvedHook } from '../../hooks/hook-engine.js'
import type { ToolOperationJournal } from '../../reliability/operation-journal.js'
import type { CapabilityRegistry } from './capability-registry.js'
import type { ReadTrackerOptions } from './read-tracker.js'
import type { ToolDispatchLeaseAuthority } from './lease-grace-gate.js'

export type ToolSideEffect = 'read-only' | 'unknown'

export type LocalTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind: 'tool_call' | 'command_execution' | 'file_change'
  /** Host-authored side-effect classification. Unknown is denied in Plan mode. */
  sideEffect?: ToolSideEffect
  /** Host-authored effects. Omission is intentionally treated as unknown. */
  effects?: ToolEffects
  /**
   * Tool policy. `auto` runs the tool without asking. `on-request` and
   * `suggest` always ask the user. `never` blocks the tool. `untrusted`
   * prompts unless the call is in an allow-list.
   */
  policy: 'auto' | 'on-request' | 'suggest' | 'never' | 'untrusted'
  /**
   * Require the configured Kun reviewer even when the low-level policy would
   * otherwise allow the call. The canonical Full access pair bypasses this
   * Kun-level gate unless `requiresApprovalInFullAccess` is also set;
   * protected host/OS/OAuth consent remains independent.
   */
  requiresExplicitApproval?:
    | boolean
    | ((call: ToolCallLike, context: ToolHostContext) => boolean)
  /**
   * Keep the explicit approval boundary even for the canonical Full access
   * pair. Reserved for external systems whose mutations cannot be rolled back
   * locally (for example sending mail or deleting a cloud resource).
   */
  requiresApprovalInFullAccess?: boolean
  /**
   * String argument names that are exact file mutation targets eligible for a
   * one-call external workspace grant. Tools must opt in explicitly; merely
   * being a `file_change` tool never grants inferred path arguments. Opted-in
   * tools must still resolve and validate the target with `resolveWorkspacePath`.
   */
  externalWritePathArguments?: readonly string[]
  /**
   * Optional gating predicate. When present, the tool is only listed
   * and only executed when `shouldAdvertise` returns true for the
   * active turn context. Use this for mode/plan-only tools such as
   * `create_plan`.
   */
  shouldAdvertise?: (context: ToolHostContext) => boolean
  /** Canonicalize transport-compatible arguments before policy, approval hashing, and execution. */
  normalizeArguments?: (args: Record<string, unknown>) => Record<string, unknown>
  /** Hide a legacy compatibility tool from model schemas without blocking a persisted/direct execution. */
  modelAdvertised?: boolean
  execute: (
    args: Record<string, unknown>,
    context: ToolHostContext,
    onUpdate?: (update: ToolExecutionUpdate) => Promise<void> | void
  ) => Promise<{ output: unknown; isError?: boolean }>
}

export type LocalToolHostOptions = {
  tools?: LocalTool[]
  registry?: CapabilityRegistry
  /** Allow-list for `untrusted` policy. Tools outside the list always prompt. */
  allowList?: string[]
  /** Optional PreToolUse/PostToolUse hooks (lifecycle phases are ignored here). */
  hooks?: readonly ResolvedHook[]
  /** Runtime read-before-edit guard. Disabled by default for direct unit use. */
  readTracker?: boolean | ReadTrackerOptions
  /**
   * Turn-scoped operation journal. Defaults to an in-memory journal so fallback
   * call ids such as `call_1` are isolated by turnId/toolName/argsHash.
   */
  operationJournal?: ToolOperationJournal
  /** Lazy runtime preparation hook (for example, activating declared extension providers). */
  prepare?: (context?: ToolHostContext) => Promise<void> | void
  /**
   * Thread execution lease authority used to pause side-effecting tool
   * dispatch during a renewal grace window. Omitted for embedded runtimes.
   */
  leaseAuthority?: ToolDispatchLeaseAuthority
}
