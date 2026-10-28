import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '@shared/app-settings'
import { kunThreadPath } from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from './runtime-client'

/** Complete authority snapshot behind one composer permission choice. */
export type ThreadPermissionPolicy = {
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer: ApprovalReviewer
}

/**
 * Room threads freeze their execution authority, so a refused write there is
 * expected rather than a failure the user has to act on.
 */
export function threadPolicyFrozenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /room thread execution policy is frozen/i.test(message)
}

/**
 * Persist the composer authority on the conversation itself.
 *
 * The permission chip writes the global runtime defaults, but a thread keeps
 * its own stored policy, and that stored policy is what worker dispatches,
 * branch turns, and notice-driven turns inherit when a request carries no
 * per-turn override. Without this write the chip can show full access while
 * those turns keep asking for approval under the conversation's older policy.
 */
export async function syncThreadPermissionPolicy(
  threadId: string,
  policy: ThreadPermissionPolicy
): Promise<'applied' | 'room_frozen'> {
  const id = threadId.trim()
  if (!id) return 'applied'
  const response = await rendererRuntimeClient.runtimeRequest(
    kunThreadPath(id),
    'PATCH',
    JSON.stringify({
      approvalPolicy: policy.approvalPolicy,
      sandboxMode: policy.sandboxMode,
      approvalReviewer: policy.approvalReviewer
    })
  )
  if (response.ok) return 'applied'
  const error = runtimeErrorToError(parseRuntimeErrorBody(response.body, 'update thread permission failed'))
  if (threadPolicyFrozenError(error)) return 'room_frozen'
  throw error
}
