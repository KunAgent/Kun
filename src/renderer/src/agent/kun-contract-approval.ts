/** Bounded, redacted action data authored by the runtime for approval review. */
export type CoreApprovalActionJson = {
  version?: 1
  kind?: 'command' | 'file' | 'network' | 'mcp' | 'external-effect' | 'unknown'
  toolName?: string
  arguments?: Record<string, unknown>
  workspace?: string
  cwd?: string
  targets?: Array<{ kind: string; value: string }>
  reason?: string
  requiresUserDecision?: boolean
}
