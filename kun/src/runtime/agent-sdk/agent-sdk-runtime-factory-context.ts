/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 *
 * The transport-independent Kun tool surface (catalog listing + in-process
 * execution) lives on the shared KunToolBridgeHost — see
 * `harness/kun-tool-bridge-host.ts` and docs/ade/05 §3.2. This context keeps
 * only the Agent-SDK-owned turn state (native session ids, delegated-session
 * preparations, handoff digests) plus attachment resolution.
 */
import type { AgentSdkRuntimeFactoryDeps } from './agent-sdk-runtime-factory-contracts.js'
import { createKunToolBridgeHost } from '../../harness/kun-tool-bridge-host.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'

export function createAgentSdkFactoryContext(deps: AgentSdkRuntimeFactoryDeps) {
  const sessionIdsByTurn = new Map<string, string>()
  const sessionPreparationsByTurn = new Map<string, DelegatedSessionPreparation>()
  // A delegated native session must checkpoint the same goal projection that
  // its request used. The goal can be completed, cleared, or replaced while
  // the request is running; using its post-turn value here would make the
  // checkpoint digest disagree with the provider's actual transcript and
  // force every later turn to rebase.
  const sessionGoalContextKeysByTurn = new Map<string, string | null>()
  // Digest of the deterministic handoff brief injected into this turn; the
  // lifecycle commit stores it on the binding for audit (docs/ade/08 §4).
  const handoffBriefDigestsByTurn = new Map<string, string>()
  const skillTurnKey = (threadId: string, turnId: string): string => `${threadId} ${turnId}`

  const nowIso = (): string => (deps.nowIso ? deps.nowIso() : new Date().toISOString())

  const toolBridge = createKunToolBridgeHost({
    threadStore: deps.threadStore,
    sessionStore: deps.sessionStore,
    registry: deps.registry,
    toolHost: deps.toolHost,
    turns: deps.turns,
    events: deps.events,
    ids: deps.ids,
    receipts: deps.receipts,
    userInputGate: deps.userInputGate,
    approvalGate: deps.approvalGate,
    approvalReview: deps.approvalReview,
    skillRuntime: deps.skillRuntime,
    toolContextBoundary: deps.toolContextBoundary,
    defaultApprovalPolicy: deps.defaultApprovalPolicy,
    defaultSandboxMode: deps.defaultSandboxMode,
    defaultApprovalReviewer: deps.defaultApprovalReviewer,
    allowHarnessBuiltins: deps.allowSdkBuiltins,
    callIdPrefix: 'call_sdk',
    nowIso
  })

  const resolveImages = async (
    threadId: string,
    workspace: string,
    attachmentIds: readonly string[]
  ): Promise<Array<{ mediaType: string; base64: string }>> => {
    if (!deps.attachmentStore || attachmentIds.length === 0) return []
    const images: Array<{ mediaType: string; base64: string }> = []
    for (const id of attachmentIds) {
      try {
        const attachment = await deps.attachmentStore.resolveContent(id, { threadId, workspace })
        if (typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('image/')) {
          images.push({ mediaType: attachment.mimeType, base64: attachment.data.toString('base64') })
        }
      } catch {
        // skip attachments that can't be resolved/authorized
      }
    }
    return images
  }
  return { sessionIdsByTurn, sessionPreparationsByTurn, sessionGoalContextKeysByTurn, handoffBriefDigestsByTurn, skillTurnKey, nowIso, toolBridge, resolveImages }
}

export type AgentSdkFactoryContext = ReturnType<typeof createAgentSdkFactoryContext>
