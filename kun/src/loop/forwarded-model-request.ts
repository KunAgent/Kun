import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ModelHistoryRoute, ModelToolSpec } from '../ports/model-client.js'
import { composeModelRequest, type ComposedModelRequest } from './model-request-composer.js'
import {
  MAX_FORWARDED_GENERATED_IMAGES,
  rehydrateGeneratedImagesForForward,
  rehydrateTransientBrowserUseOutputsForForward
} from './tool-result-image.js'
import type { TokenEconomyConfig } from './token-economy.js'
import type { TurnAttachmentService } from './turn-attachment-service.js'
import type { ResolvedTurnAttachments } from './turn-execution-types.js'

export async function composeForwardedModelRequest(input: {
  history: TurnItem[]
  threadId: string
  thread: ThreadRecord
  turnId: string
  model: string
  modelCapabilities: ModelCapabilityMetadata
  providerId?: string
  accountId?: string
  reasoningEffort?: string
  serviceTier?: 'priority'
  modeInstruction?: string
  contextInstructions: readonly string[]
  redactedRequestValues?: readonly string[]
  historyRoutesByTurnId: Readonly<Record<string, ModelHistoryRoute>>
  requestToolSpecs: readonly ModelToolSpec[]
  attachments: ResolvedTurnAttachments
  hardRequiredToolName?: string
  promptCachePartition: string
  immutablePrefix: ImmutablePrefix
  tokenEconomy?: TokenEconomyConfig
  turnAttachments: TurnAttachmentService
  signal: AbortSignal
}): Promise<ComposedModelRequest> {
  const forwardHistory = await rehydrateGeneratedImagesForForward(
    rehydrateTransientBrowserUseOutputsForForward(input.history),
    (output) => input.turnAttachments.resolveGeneratedImageForForward(
      output,
      input.threadId,
      input.thread.workspace
    ),
    MAX_FORWARDED_GENERATED_IMAGES
  )
  const messageAttachments = await input.turnAttachments.resolveHistoryAttachments({
    items: forwardHistory,
    threadId: input.threadId,
    workspace: input.thread.workspace,
    modelCapabilities: input.modelCapabilities,
    restrictMetadata: input.thread.turns.find((turn) => turn.id === input.turnId)?.attachmentAliases !== undefined
  })
  const hasCurrentAttachmentOwner = forwardHistory.some(
    (item) => item.kind === 'user_message' && item.turnId === input.turnId &&
      Boolean(item.attachmentIds?.length)
  )
  const requestAttachments = hasCurrentAttachmentOwner
    ? { imageAttachments: [], textFallbacks: [], documents: [] }
    : input.attachments
  return composeModelRequest({
    threadId: input.thread.id,
    turnId: input.turnId,
    model: input.model,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    promptCachePartition: input.promptCachePartition,
    immutablePrefix: input.immutablePrefix,
    ...(input.thread.systemPrompt !== undefined
      ? { threadSystemPrompt: input.thread.systemPrompt }
      : {}),
    ...(input.modeInstruction ? { modeInstruction: input.modeInstruction } : {}),
    contextInstructions: input.contextInstructions,
    ...(input.redactedRequestValues?.length
      ? { redactedRequestValues: input.redactedRequestValues }
      : {}),
    history: forwardHistory,
    historyRoutesByTurnId: input.historyRoutesByTurnId,
    attachments: requestAttachments,
    ...(Object.keys(messageAttachments).length ? { messageAttachments } : {}),
    tools: input.requestToolSpecs,
    ...(input.hardRequiredToolName ? { requiredToolName: input.hardRequiredToolName } : {}),
    ...(input.tokenEconomy ? { tokenEconomy: input.tokenEconomy } : {}),
    signal: input.signal
  })
}
