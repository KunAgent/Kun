import { randomUUID } from 'node:crypto'
import {
  type DelegationRuntime
} from '../../delegation/delegation-runtime.js'
import { ModelReasoningEffort } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { TurnService } from '../../services/turn-service.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { PptPreviewMode } from '../../ppt/ppt-review-manifest.js'
import { classifyPptDirectionGate } from '../../ppt/ppt-direction-workflow.js'
import {
  formatPptCoreDesignPolicyControl,
  loadPptCoreDesignPolicy
} from '../../ppt/ppt-design-policy.js'
import { requireToolchainDirectory } from './ppt-agent-local-tools-support.js'
import { validatePersistedPptReviewIdentity } from './ppt-agent-review-context.js'
import { validatePersistedPptDirectionIdentity } from './ppt-agent-direction-context.js'
import {
  directionBundleContractError,
  reviewBundleContractError,
  validatedDeckArtifact
} from './ppt-agent-output-contracts.js'
import {
  blocksPptExport,
  deliverableInstruction,
  effectivePptProviderId,
  imageFirstFallbackNotice,
  initialPptPreviewMode,
  managedPptProviderUnavailable,
  pptAgentAction,
  visualWorkflowInstruction,
  type PptAgentAction
} from './ppt-agent-workflow-control.js'
import {
  PPT_AGENT_ALLOWED_TOOLS,
  buildPptProviderProfile,
  childPptSourceEnvelope,
  emitPptLifecycleUpdate,
  pptProviderChildSecurity,
  resolvePptProviderSource,
  scopePptDirectionContext,
  scopePptDirectionInputAnswer,
  scopePptReviewContext,
  stringValue,
  type PptProviderDirectionContext,
  type PptProviderReviewContext,
  type PptProviderSourceEnvelope
} from './ppt-agent-provider-support.js'
import { resolvePptRetryState } from './ppt-agent-retry-state.js'
import { elapsedMs } from '../../delegation/delegation-runtime-support.js'
import {
  resolvePptPromptDirectionSelection,
  resolvePptUserInputDirectionSelection
} from './ppt-agent-direction-prompt.js'

export const PPT_AGENT_TOOL_NAME = 'ppt_agent' as const
export const PPT_AGENT_PROVIDER_ID = 'ppt-agent' as const

export type PptAgentToolConfig = {
  enabled?: boolean
  model?: string
  providerId?: string
  reasoningEffort?: ModelReasoningEffort
  fast?: boolean
  imageFirst?: boolean
  imageGenAvailable?: boolean
  imageGenReason?: string
  imageGenSupportsReferenceEdit?: boolean
  /** Runtime providers that cannot execute Kun's governed local PPT tools. */
  toolIncompatibleProviderIds?: readonly string[]
  /** Covers a provider-kind default when the active route has no provider id. */
  defaultProviderLacksManagedTools?: boolean
}

export type PptAgentTurnReader = Pick<TurnService, 'getTurn'>

export type PptReviewContextV1 = PptProviderReviewContext
export type PptDirectionContextV1 = PptProviderDirectionContext
export type PptSourceEnvelope = PptProviderSourceEnvelope

/**
 * First-class PPT allow-list. Full file authoring plus the managed `ppt_export`
 * tool, web helpers and image generation
 * so the child can build a PPTD project, export a verified PPTX and generate
 * artwork. Deliberately excludes `ppt_to_board`, GUI design tools and the
 * delegation tools: whiteboard layout is replayed by the parent agent because
 * child design-tool results never reach the canvas (verdict B), and the child
 * must not spin up further children.
 */
export { PPT_AGENT_ALLOWED_TOOLS }

const PPT_AGENT_DESCRIPTION = [
  'Use `ppt_agent` for any presentation/PPT task: create, edit, replicate, or read a deck.',
  'It reads the exact active user turn and its attachments from the host; never restate, summarize, expand, or invent presentation content in tool arguments.',
  'For `action="start"`, pass a required short `title` (2-6 words, at most 160 characters) naming the task for UI surfaces; follow-up actions need only the original childId and workflowId.',
  'Structured review selections are resolved from the active turn context.',
  'The short title is display metadata only and never enters the child request.',
  'The child writes deck files under the workspace; the parent owns deliverable verification (deck structure, .pptx export, per-page fade).',
  'PPT 演示文稿任务（创建/编辑/复刻/读取）都应优先交给 ppt_agent；主代理只传工作流控制，不得改写用户内容。'
].join(' ')

/**
 * First-class `ppt_agent` tool: the host forwards the exact active turn to an
 * isolated PPT child and injects the canonical governed design workflow. It
 * reuses the whole subagent runtime (child thread, events,
 * approval inheritance, SubagentCallCard rendering) while keeping the
 * delegate_task router untouched. Lab disable is enforced live via
 * `shouldAdvertise` (and an execute backstop), mirroring fast_context.
 */
export function buildPptAgentToolProvider(
  runtime: DelegationRuntime | undefined,
  config: () => PptAgentToolConfig | undefined,
  turns?: PptAgentTurnReader
): CapabilityToolProvider[] {
  if (!runtime?.enabled()) return []
  const shouldAdvertise = (_context: ToolHostContext): boolean =>
    config()?.enabled !== false
  return [
    {
      id: PPT_AGENT_PROVIDER_ID,
      kind: 'delegation',
      enabled: true,
      available: true,
      tools: [
        LocalToolHost.defineTool({
          name: PPT_AGENT_TOOL_NAME,
          description: PPT_AGENT_DESCRIPTION,
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['start', 'select_direction', 'revise_directions', 'revise_previews', 'retry_failed', 'approve_and_build'],
                description: 'Workflow action. Defaults to start; direction and review follow-ups resume the original PPT child.'
              },
              childId: { type: 'string', description: 'Existing PPT child id required for a review follow-up.' },
              workflowId: { type: 'string', description: 'Persisted PPT review workflow id required for a review follow-up.' },
              title: {
                type: 'string',
                maxLength: 160,
                description: 'Required for action="start": a short 2-6 word UI title (at most 160 characters) naming this task. Optional display metadata; never sent as presentation content. Follow-up actions do not repeat it.'
              }
            },
            required: [],
            additionalProperties: false
          },
          policy: 'auto',
          // The child writes deck files, so this is a mutation surface. The
          // registry models sideEffect as 'read-only' | 'unknown' only;
          // 'unknown' is the convention for mutation tools (see graph tools).
          sideEffect: 'unknown',
          shouldAdvertise,
          execute: async (args, context, onUpdate) => {
            const cfg = config()
            if (cfg?.enabled === false) {
              return {
                output: { error: 'ppt_agent is disabled in Lab settings' },
                isError: true
              }
            }
            const source = await resolvePptProviderSource(turns, context)
            if (!source.ok) {
              return {
                output: { phase: 'source_unavailable', error: source.error },
                isError: true
              }
            }
            const action = pptAgentAction(args.action)
            const title = stringValue(args.title)
            if (action === 'start' && !title) {
              return {
                output: {
                  error: 'ppt_agent requires a short UI title for action="start"; retry the call with a 2-6 word title naming the task'
                },
                isError: true
              }
            }
            const workspace = context.workspace
            const configuredCfg = cfg ?? {}
            const effectiveProvider = effectivePptProviderId(configuredCfg, context)
            if (managedPptProviderUnavailable(configuredCfg, effectiveProvider)) {
              return {
                output: {
                  phase: 'unavailable',
                  error: 'The selected provider cannot execute Kun managed PPT tools; configure a tool-capable PPT Agent model in Lab settings'
                },
                isError: true
              }
            }
            const imageGenAllowed =
              (!context.allowedToolNames || context.allowedToolNames.includes('generate_image')) &&
              !context.blockedToolNames?.includes('generate_image')
            const resolvedCfg: PptAgentToolConfig = {
              ...configuredCfg,
              imageGenAvailable: configuredCfg.imageGenAvailable === true && imageGenAllowed,
              ...(!imageGenAllowed
                ? { imageGenReason: 'generate_image is unavailable in the current tool policy' }
                : {})
            }
            const childId = stringValue(args.childId)
            const requestedWorkflowId = stringValue(args.workflowId)
            const workflowId = action === 'start'
              ? `ppt_${randomUUID()}`
              : requestedWorkflowId
            const projectDir = `.kun/ppt/${workflowId}`
            const deliverable = 'pptx' as const
            if (action !== 'start' && (!childId || !workflowId)) {
              return { output: { error: 'childId and workflowId are required for PPT review follow-ups' }, isError: true }
            }
            const retryState = action === 'retry_failed'
              ? await resolvePptRetryState({
                  runtime,
                  parentThreadId: context.threadId,
                  childId,
                  workflowId
                })
              : undefined
            if (retryState && !retryState.ok) {
              return { output: { phase: 'source_unavailable', error: retryState.error }, isError: true }
            }
            const retry = retryState?.ok ? retryState.value : undefined
            const retryingDirection = retry?.stage === 'direction'
            const retryingInitialStage = Boolean(retry && (
              retry.stage === 'direction' ? !retry.hasDirectionBundle : !retry.hasReviewBundle
            ))
            const directionContextAction = action === 'select_direction' || action === 'revise_directions'
            const directionGate = action === 'start'
              ? classifyPptDirectionGate({
                  prompt: source.value.prompt,
                  fileReferences: source.value.fileReferences,
                  attachmentIds: source.value.attachmentIds,
                  agentSurface: source.value.agentSurface
                })
              : retryingDirection
                ? retry?.directionGate
                : undefined
            if (directionGate?.required && resolvedCfg.imageGenAvailable !== true) {
              return {
                output: {
                  workflowId,
                  projectDir,
                  phase: 'unavailable',
                  error: 'Visual direction selection requires generate_image; configure an image-generation model or provide an explicit design authority'
                },
                isError: true
              }
            }
            const scopedDirection = scopePptDirectionContext(
              source.value.directionContexts, action, childId, workflowId)
            if (!scopedDirection.ok) {
              return { output: { phase: 'source_unavailable', error: scopedDirection.error }, isError: true }
            }
            const directionInputAnswer = scopePptDirectionInputAnswer(
              source.value.directionInputAnswers, action, childId, workflowId)
            const scopedReview = retryingDirection || (retry?.stage === 'review' && !retry.hasReviewBundle)
              ? { ok: true as const, value: undefined }
              : scopePptReviewContext(source.value.reviewContexts, action, childId, workflowId)
            if (!scopedReview.ok) {
              return { output: { phase: 'source_unavailable', error: scopedReview.error }, isError: true }
            }
            let persistedPreviewMode: PptPreviewMode | undefined
            let persistedPlanFingerprint: string | undefined
            let directionAuthority: Array<{
              directionId: string
              revision: number
              recommended: boolean
              planFingerprint: string
              candidateFingerprint: string
            }> | undefined
            let directionSlidesFingerprint: string | undefined
            let resolvedDirectionSelection: Array<{ directionId: string; revision: number }> | undefined
            if (directionContextAction || (retryingDirection && retry?.hasDirectionBundle)) {
              const identity = await validatePersistedPptDirectionIdentity(
                runtime,
                context.threadId,
                childId,
                workflowId,
                scopedDirection.value
              )
              if (!identity.ok) {
                return { output: { phase: 'source_unavailable', error: identity.error }, isError: true }
              }
              persistedPreviewMode = identity.previewMode
              directionAuthority = identity.authority
              directionSlidesFingerprint = identity.bundle.slidesFingerprint
              if (action === 'select_direction') {
                const selection = directionInputAnswer
                  ? resolvePptUserInputDirectionSelection({
                      answer: directionInputAnswer.answer,
                      directions: identity.bundle.directions
                    })
                  : resolvePptPromptDirectionSelection({
                      prompt: source.value.prompt,
                      directions: identity.bundle.directions,
                      structuredSelection: scopedDirection.value?.directions
                    })
                if (!selection.ok) {
                  const selectedDirectionCount = scopedDirection.value?.directions.length ?? 0
                  const message = directionInputAnswer
                    ? selection.reason === 'ambiguous'
                      ? 'PPT source unavailable: the user-input direction answer is ambiguous'
                      : 'PPT source unavailable: the user-input answer does not match a persisted direction'
                    : selectedDirectionCount > 0
                    ? 'PPT source unavailable: explicitly adopt the selected direction before promotion'
                    : selection.reason === 'ambiguous'
                      ? 'PPT source unavailable: direction reply is ambiguous; name exactly one direction'
                      : selection.reason === 'direction_required'
                        ? 'PPT source unavailable: reply with one direction name or number, or explicitly accept the recommended direction'
                        : 'PPT source unavailable: explicitly accept a direction by name or number, or accept the recommended direction'
                  return { output: { phase: 'source_unavailable', error: message }, isError: true }
                }
                const structuredSelection = scopedDirection.value?.directions[0]
                if (structuredSelection && (
                  structuredSelection.directionId !== selection.selection.directionId ||
                  structuredSelection.revision !== selection.selection.revision
                )) {
                  return {
                    output: {
                      phase: 'source_unavailable',
                      error: 'PPT source unavailable: user input conflicts with the selected whiteboard direction'
                    },
                    isError: true
                  }
                }
                resolvedDirectionSelection = [selection.selection]
              }
            } else if (action !== 'start' && !retryingDirection && !(retry?.stage === 'review' && !retry.hasReviewBundle)) {
              if (!scopedReview.value) {
                return { output: { phase: 'source_unavailable', error: 'PPT source unavailable: review context is required' }, isError: true }
              }
              const identity = await validatePersistedPptReviewIdentity(
                runtime,
                context.threadId,
                scopedReview.value
              )
              if (!identity.ok) {
                return { output: { phase: 'source_unavailable', error: identity.error }, isError: true }
              }
              if (!identity.previewMode || !identity.planFingerprint) {
                return {
                  output: {
                    phase: 'unavailable',
                    error: 'This pre-governance PPT review cannot be migrated in place; start a new PPT Agent workflow while the existing legacy artifacts remain unchanged'
                  },
                  isError: true
                }
              }
              persistedPreviewMode = identity.previewMode
              persistedPlanFingerprint = identity.planFingerprint
            }
            const previewMode = persistedPreviewMode ?? retry?.previewMode ?? initialPptPreviewMode(resolvedCfg)
            if (
              action !== 'start' &&
              action !== 'approve_and_build' &&
              (previewMode === 'image-first' || action === 'revise_directions') &&
              resolvedCfg.imageGenAvailable !== true
            ) {
              return {
                output: {
                  childId,
                  workflowId,
                  projectDir,
                  phase: 'failed_recoverable',
                  mode: 'visual-first',
                  error: action === 'revise_directions'
                    ? 'PPT visual directions cannot be revised because generate_image is currently unavailable; retry after restoring the image-generation capability'
                    : 'PPT image-first review cannot continue because generate_image is currently unavailable; retry after restoring the image-generation capability'
                },
                isError: true
              }
            }
            const toolchain = await requireToolchainDirectory({})
            const policyControl = formatPptCoreDesignPolicyControl(
              await loadPptCoreDesignPolicy(toolchain)
            )
            const inlineProfile = buildPptProviderProfile(resolvedCfg)
            const fallbackNotice = imageFirstFallbackNotice(resolvedCfg, action)
            const workflowInstruction = visualWorkflowInstruction(
              resolvedCfg,
              previewMode,
              action,
              workflowId,
              context.threadId,
              projectDir,
              scopedReview.value !== undefined,
              directionGate?.required === true || retryingDirection,
              retry?.stage,
              retry?.stage === 'direction' ? retry.hasDirectionBundle : retry?.hasReviewBundle
            )
            const executionBlockedTools = blocksPptExport(action)
              ? ['ppt_export']
              : undefined
            const workflowStage = retry?.stage ?? (
              action === 'approve_and_build'
                ? 'build'
                : directionGate?.required === true || action === 'revise_directions'
                  ? 'direction'
                  : 'review'
            )
            const pptWorkflowScope = {
              action,
              stage: workflowStage,
              workflowId,
              projectDir,
              parentThreadId: context.threadId,
              previewMode,
              ...((action === 'start' || retryingInitialStage) &&
              source.value.agentSurface === 'write' &&
              source.value.fileReferences.some((file) => /\.(?:md|markdown)$/i.test(file.name))
                ? { sourceReadRequired: true }
                : {}),
              ...(directionGate ? { directionGate } : {}),
              ...(directionContextAction || (retryingDirection && retry?.hasDirectionBundle)
                ? {
                    directionContext: {
                      childId,
                      directions: resolvedDirectionSelection ?? scopedDirection.value?.directions ?? [],
                      authority: directionAuthority?.map((direction) => ({
                        directionId: direction.directionId,
                        revision: direction.revision,
                        recommended: direction.recommended,
                        planFingerprint: direction.planFingerprint,
                        candidateFingerprint: direction.candidateFingerprint
                      })) ?? [],
                      slidesFingerprint: directionSlidesFingerprint ?? ''
                    }
                  }
                : {}),
              ...(scopedReview.value
                ? {
                    reviewContext: {
                      childId: scopedReview.value.childId,
                      slides: scopedReview.value.slides
                    }
                  }
                : {})
            } as const
            const controlPrompt = [
              policyControl,
              `PPT WORKFLOW CONTROL: action=${action}; workflowId=${workflowId}; projectDir=${projectDir}.`,
              fallbackNotice,
              workflowInstruction,
              deliverableInstruction(deliverable, action)
            ].filter(Boolean).join('\n\n')
            const childSecurity = pptProviderChildSecurity(context, workspace, projectDir)
            const record = action === 'start'
              ? await runtime.runChild({
              parentThreadId: context.threadId,
              parentTurnId: context.turnId,
              launcher: 'ppt_agent',
              label: title ?? 'Presentation',
              prompt: source.value.prompt,
              source: childPptSourceEnvelope(source.value),
              controlPrompt,
              pptWorkflowScope,
              workspace,
              inlineProfile,
              agentSurface: source.value.agentSurface ?? 'code',
              // Follow the parent session's model/provider/reasoning/service
              // tier unless the Lab settings configure an explicit override.
              inheritSessionDefaults: true,
              ...(resolvedCfg.fast === true ? { serviceTier: 'priority' as const } : {}),
              ...(context.serviceTier ? { inheritedServiceTier: context.serviceTier } : {}),
              ...(context.actingModelRoute?.model
                ? { inheritedModel: context.actingModelRoute.model }
                : context.model?.id?.trim()
                  ? { inheritedModel: context.model.id.trim() }
                  : {}),
              ...(context.actingModelRoute?.providerId
                ? { inheritedProviderId: context.actingModelRoute.providerId }
                : context.modelProviderId?.trim()
                  ? { inheritedProviderId: context.modelProviderId.trim() }
                  : {}),
              ...(context.actingModelRoute?.accountId
                ? { inheritedAccountId: context.actingModelRoute.accountId }
                : {}),
              ...(context.reasoningEffort?.trim()
                ? { inheritedReasoningEffort: context.reasoningEffort.trim() }
                : {}),
              ...(context.guiDesignCanvas === true ? { guiDesignCanvas: true } : {}),
              security: childSecurity,
              ...(executionBlockedTools ? { executionBlockedTools } : {}),
              approvalPolicy: context.approvalPolicy,
              ...(context.sandboxMode ? { sandboxMode: context.sandboxMode } : {}),
              approvalReviewer: context.approvalReviewer ?? 'user',
              ...(context.clientSurface ? { clientSurface: context.clientSurface } : {}),
              returnFormat: 'summary',
              onQueued: async (childId, profile, metadata) => {
                await emitPptLifecycleUpdate(onUpdate, {
                  childId,
                  status: 'queued',
                  title,
                  profile,
                  metadata: {
                    ...metadata,
                    profileName: metadata?.profileName?.trim() || 'PPT Agent',
                    model: metadata?.model?.trim() ||
                      context.actingModelRoute?.model?.trim() ||
                      context.model?.id?.trim() ||
                      undefined
                  }
                })
              },
              onRunning: async (childId, profile, metadata) => {
                await emitPptLifecycleUpdate(onUpdate, {
                  childId,
                  status: 'running',
                  title,
                  profile,
                  metadata: {
                    ...metadata,
                    profileName: metadata?.profileName?.trim() || 'PPT Agent',
                    model: metadata?.model?.trim() ||
                      context.actingModelRoute?.model?.trim() ||
                      context.model?.id?.trim() ||
                      undefined
                  }
                })
              },
              signal: context.abortSignal
            })
              : await runtime.resumeChild({
                childId,
                parentThreadId: context.threadId,
                parentTurnId: context.turnId,
                prompt: source.value.prompt,
                source: childPptSourceEnvelope(source.value),
                controlPrompt,
                pptWorkflowScope,
                expectedProfile: 'ppt',
                expectedLaunchers: ['ppt_agent'],
                expectedWorkflowId: workflowId,
                security: childSecurity,
                ...(executionBlockedTools ? { executionBlockedTools } : {}),
                signal: context.abortSignal,
                onQueued: async (resumedChildId, profile, metadata) => emitPptLifecycleUpdate(onUpdate, {
                  childId: resumedChildId,
                  status: 'queued',
                  title,
                  profile,
                  metadata
                }),
                onRunning: async (resumedChildId, profile, metadata) => emitPptLifecycleUpdate(onUpdate, {
                  childId: resumedChildId,
                  status: 'running',
                  title,
                  profile,
                  metadata
                })
              })
            const directionExpected = workflowStage === 'direction'
            const freshReviewBundle = record.reviewBundleParentTurnId === context.turnId
              ? record.reviewBundle
              : undefined
            const freshReviewPhase = freshReviewBundle && typeof freshReviewBundle === 'object' &&
              !Array.isArray(freshReviewBundle) && 'phase' in freshReviewBundle
              ? freshReviewBundle.phase
              : undefined
            const recoverableQaReview = action === 'approve_and_build' &&
              freshReviewPhase === 'failed_recoverable'
            const completedQaReview = action === 'approve_and_build' && freshReviewPhase === 'completed'
            const reviewExpected = !directionExpected && (action !== 'approve_and_build' || recoverableQaReview)
            const currentDirectionBundle = directionExpected && record.directionBundleParentTurnId === context.turnId
              ? record.directionBundle
              : undefined
            const currentReviewBundle = reviewExpected || completedQaReview ? freshReviewBundle : undefined
            const directionContractError = directionExpected && currentDirectionBundle === undefined
              ? 'PPT child completed without the required visual direction bundle'
              : directionBundleContractError(currentDirectionBundle, record.id, workflowId, projectDir, previewMode)
            const reviewContractError = reviewExpected && currentReviewBundle === undefined
              ? 'PPT child completed without the required visual review bundle'
              : currentReviewBundle === undefined
                ? ''
                : reviewBundleContractError(currentReviewBundle, record.id, workflowId, projectDir, previewMode)
            const deckArtifact = record.deckArtifactParentTurnId === context.turnId
              ? record.deckArtifact
              : undefined
            const deckExpected = deliverable === 'pptx' && action === 'approve_and_build'
            const deckContractError = deckExpected && !recoverableQaReview && !validatedDeckArtifact(
              deckArtifact,
              workflowId,
              projectDir,
              persistedPlanFingerprint
            )
              ? 'PPT child completed without a validated PPTX export'
              : ''
            const contractError = directionContractError || reviewContractError || deckContractError
            const hasFreshStructuredResult = currentDirectionBundle !== undefined || currentReviewBundle !== undefined
            const childFailed = record.status === 'failed' || record.status === 'aborted'
            const failed = Boolean(contractError) || (childFailed && !hasFreshStructuredResult)
            const resolvedModel =
              record.model?.trim() ||
              (typeof context.actingModelRoute?.model === 'string'
                ? context.actingModelRoute.model.trim()
                : '') ||
              context.model?.id?.trim() ||
              ''
            const profileName =
              record.profileSnapshot?.name?.trim() ||
              'PPT Agent'
            return {
              output: {
                childId: record.id,
                parentThreadId: record.parentThreadId,
                parentTurnId: record.parentTurnId,
                resumeCount: record.resumeCount ?? 0,
                workflowId,
                projectDir,
                status: record.status,
                title: title ?? '',
                summary: record.summary ?? '',
                phase: recoverableQaReview
                  ? 'failed_recoverable'
                  : failed
                  ? 'failed_recoverable'
                  : currentDirectionBundle
                    ? 'awaiting_direction'
                    : currentReviewBundle && action !== 'approve_and_build'
                      ? 'awaiting_review'
                      : 'completed',
                mode: previewMode === 'editable' ? 'direct' : 'visual-first',
                deliverable,
                ...(fallbackNotice ? { fallbackNotice } : {}),
                ...(currentDirectionBundle !== undefined ? { directionBundle: currentDirectionBundle } : {}),
                ...(currentReviewBundle !== undefined ? { reviewBundle: currentReviewBundle } : {}),
                ...(deckArtifact !== undefined ? { deckArtifact } : {}),
                toolInvocations: record.toolInvocations ?? 0,
                usage: record.usage,
                profile: 'ppt',
                profileName,
                ...(resolvedModel ? { model: resolvedModel } : {}),
                ...(record.startedAt ? {
                  attemptStartedAt: record.startedAt,
                  attemptDurationMs: elapsedMs(record.startedAt, record.updatedAt)
                } : {}),
                ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
                ...(failed || recoverableQaReview
                  ? { error: formatPptChildError(
                      contractError,
                      record.error,
                      recoverableQaReview ? 'PPT geometry QA requires review' : record.status
                    ) }
                  : {})
              },
              isError: failed
            }
          }
        })
      ]
    }
  ]
}

function formatPptChildError(contractError: string, childError: string | undefined, fallback: string): string {
  const detail = childError?.trim()
  if (!contractError) return detail || fallback
  if (!detail || detail === contractError) return contractError
  return `${contractError}. Child error: ${detail}`
}
