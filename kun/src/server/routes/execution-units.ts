import { z } from 'zod'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ActivityWorkspaceSchema } from '../../contracts/activity.js'
import { HarnessIdSchema } from '../../contracts/harness.js'
import type { TerminalAgentRegistry } from '../../services/terminal-agent-registry.js'
import type { HarnessTokenService } from '../../harness/harness-token-service.js'
import type { HarnessCatalog } from '../../harness/harness-catalog.js'

/**
 * Execution-unit lifecycle surface for host-launched tier-0 units
 * (05 §6.1). `POST /v1/execution-units` registers a terminal agent and
 * mints the scoped `kgw_` tokens its PTY env carries; `/exit` and
 * `/interrupt-hint` close the loop from the owning client.
 */

export const ExecutionUnitCreateSchema = z
  .object({
    kind: z.literal('terminal-agent'),
    harnessId: HarnessIdSchema,
    /** Task-workspace record id when the unit runs inside one (07). */
    workspaceId: z.string().min(1).max(256).optional(),
    workspace: ActivityWorkspaceSchema,
    title: z.string().min(1).max(200),
    parentThreadId: z.string().min(1).max(256).optional()
  })
  .strict()

export const ExecutionUnitExitSchema = z
  .object({
    exitCode: z.number().int(),
    signal: z.string().max(64).optional()
  })
  .strict()

export type ExecutionUnitRouteDeps = {
  registry: TerminalAgentRegistry
  tokens: HarnessTokenService
  catalog: HarnessCatalog
  /** Loopback base URL filled once the listener binds. */
  endpoint?: () => string | undefined
}

export async function executionUnitCreateResponse(
  deps: ExecutionUnitRouteDeps,
  request: Request
): Promise<JsonResponse> {
  const parsed = ExecutionUnitCreateSchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!parsed.success) {
    return jsonResponse({ code: 'validation_error', message: 'invalid execution unit body' }, 400)
  }
  const body = parsed.data
  const definition = deps.catalog.get(body.harnessId)
  if (!definition?.terminal) {
    return jsonResponse(
      { code: 'validation_error', message: `harness ${body.harnessId} has no terminal launch` },
      400
    )
  }
  const record = await deps.registry.register({
    harnessId: body.harnessId,
    title: body.title,
    workspace: body.workspace,
    ...(body.workspaceId ? { taskWorkspaceId: body.workspaceId } : {}),
    ...(body.parentThreadId ? { parentThreadId: body.parentThreadId } : {})
  })
  const issue = (scopes: readonly ['worker-callback'] | readonly ['hook-ingest']) =>
    deps.tokens.issue({
      threadId: record.unitId,
      harnessId: body.harnessId,
      credentialIdentity: `terminal-agent:${record.unitId}`,
      scopes
    })
  return jsonResponse({
    unitId: record.unitId,
    tokens: {
      workerCallback: issue(['worker-callback']),
      hookIngest: issue(['hook-ingest'])
    },
    endpoint: deps.endpoint?.() ?? null,
    /**
     * Launch additions managed hooks inject (05 §6.2, P2-03): extra argv
     * flags or env (config dirs) the PTY spawn merges verbatim.
     */
    launch: { args: [] as string[], env: {} as Record<string, string> }
  })
}

export async function executionUnitExitResponse(
  deps: Pick<ExecutionUnitRouteDeps, 'registry'>,
  request: Request,
  unitId: string
): Promise<JsonResponse> {
  const parsed = ExecutionUnitExitSchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!parsed.success) {
    return jsonResponse({ code: 'validation_error', message: 'invalid exit body' }, 400)
  }
  const record = await deps.registry.reportExit(unitId, parsed.data)
  if (!record) return jsonResponse({ code: 'not_found', message: 'unknown execution unit' }, 404)
  return jsonResponse({ unitId, closed: true })
}

export async function executionUnitInterruptHintResponse(
  deps: Pick<ExecutionUnitRouteDeps, 'registry'>,
  unitId: string
): Promise<JsonResponse> {
  const found = await deps.registry.interruptHint(unitId)
  if (!found) return jsonResponse({ code: 'not_found', message: 'unknown execution unit' }, 404)
  return jsonResponse({ unitId, inferredInterrupt: true })
}
