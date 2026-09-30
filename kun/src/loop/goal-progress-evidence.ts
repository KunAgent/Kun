import { createHash } from 'node:crypto'
import type { ToolCallLike, ToolHostResult } from '../ports/tool-host.js'

/** Bounded, semantic evidence: successful reads, shell exit codes and IDs alone
 * cannot prove that the objective advanced. Concrete file changes and passed
 * project verification count; volatile IDs and diagnostic output do not.
 * Goal completion is still explicit through update_goal; this is a retry guard,
 * not an automatic claim that a task is complete. */
export function goalProgressEvidence(
  toolName: string, result: ToolHostResult, call?: ToolCallLike
): string | null {
  if (result.item.kind !== 'tool_result' || result.item.isError) return null
  const output = result.item.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const value = output as Record<string, unknown>
  if (value.error || value.changed === false || value.noop === true) return null
  if (toolName === 'verify_changes' && value.status === 'passed' &&
    Array.isArray(value.changed_files) && value.changed_files.length &&
    Array.isArray(value.checks) && value.checks.length) {
    const checks = value.checks as Array<Record<string, unknown>>
    if (checks.some((check) => check.exitCode !== 0)) return null
    return fingerprint([toolName, [...value.changed_files].sort(),
      checks.map((check) => [check.command, check.args, check.cwd, check.label, check.exitCode])])
  }
  const path = value.path ?? value.relative_path
  if (typeof path !== 'string' || !path.trim()) return null
  let change: unknown
  if (toolName === 'write' && value.changed === true && typeof call?.arguments.content === 'string' &&
    typeof value.bytes_written === 'number') {
    change = call.arguments.content
  } else if (toolName === 'edit' && typeof value.patch === 'string' && value.patch.trim()) {
    change = value.patch
  } else {
    return null
  }
  return fingerprint([toolName, path, change])
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Remember the whole bounded run rather than just its previous result, so
 * alternating A/B edits cannot repeatedly replenish the no-progress budget. */
export class GoalProgressEvidence {
  private readonly turns = new Map<string, { progress: boolean; withoutProgress: number }>()
  private readonly goals = new Map<string, { key: string; fingerprints: Set<string> }>()

  begin(threadId: string, key: string): void {
    if (this.goals.get(threadId)?.key !== key) {
      this.goals.set(threadId, { key, fingerprints: new Set() })
    }
  }

  note(turnId: string, toolName: string, result: ToolHostResult, call?: ToolCallLike): void {
    const state = this.turns.get(turnId) ?? { progress: false, withoutProgress: 0 }
    const evidence = goalProgressEvidence(toolName, result, call)
    const threadId = result.item.threadId
    this.begin(threadId, this.goals.get(threadId)?.key ?? '')
    const seen = this.goals.get(threadId)!.fingerprints
    if (evidence && !seen.has(evidence) && seen.size < 512) {
      seen.add(evidence)
      state.progress = true
      state.withoutProgress = 0
    } else {
      state.withoutProgress += 1
    }
    this.turns.set(turnId, state)
  }

  hasProgress(turnId: string): boolean { return this.turns.get(turnId)?.progress ?? false }
  withoutProgress(turnId: string): number { return this.turns.get(turnId)?.withoutProgress ?? 0 }
  clearTurn(turnId: string): void { this.turns.delete(turnId) }
  clearGoal(threadId: string): void { this.goals.delete(threadId) }
  clear(): void { this.turns.clear(); this.goals.clear() }
}
