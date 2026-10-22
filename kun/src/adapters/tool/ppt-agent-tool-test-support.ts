import { InMemoryEventBus } from '../in-memory-event-bus.js'
import { InMemorySessionStore } from '../in-memory-session-store.js'
import { InMemoryThreadStore } from '../in-memory-thread-store.js'
import { ContextCompactor } from '../../loop/context-compactor.js'
import { InflightTracker } from '../../loop/inflight-tracker.js'
import { SteeringQueue } from '../../loop/steering-queue.js'
import { SequentialIdGenerator } from '../../ports/id-generator.js'
import { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { TurnService } from '../../services/turn-service.js'
import {
  DelegationRuntime,
  FileDelegationStore,
  type ChildRunExecutor
} from '../../delegation/delegation-runtime.js'
import { SubagentsCapabilityConfig } from '../../contracts/capabilities.js'
import { TurnSchema, type Turn } from '../../contracts/turns.js'
import {
  type PptAgentToolConfig,
  type PptAgentTurnReader,
  buildPptAgentToolProvider
} from './ppt-agent-tool-provider.js'

export function makePptTestRuntime(dir: string, executor: ChildRunExecutor): DelegationRuntime {
  const nowIso = () => '2026-07-08T00:00:00.000Z'
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso
  })
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso
  })
  return new DelegationRuntime({
    config: SubagentsCapabilityConfig.parse({
      enabled: true,
      maxParallel: 1,
      profiles: { general: { mode: 'subagent', toolPolicy: 'inherit' } }
    }),
    store: new FileDelegationStore(dir),
    events,
    threadStore,
    turns,
    nowIso,
    executor
  })
}

export const pptTestContext = {
  threadId: 'thr_main',
  turnId: 'turn_main',
  workspace: '/workspace',
  agentSurface: 'code' as const,
  clientSurface: 'gui' as const,
  approvalPolicy: 'auto' as const,
  approvalReviewer: 'user' as const,
  awaitApproval: async () => 'allow' as const,
  model: {
    id: 'main-model',
    inputModalities: ['text'] as ('text' | 'image')[],
    outputModalities: ['text'] as ('text' | 'image')[],
    supportsToolCalling: true,
    messageParts: ['text'] as ('text' | 'image_url' | 'input_image')[],
    contextWindowTokens: 128_000
  },
  actingModelRoute: { model: 'main-model', providerId: 'deepseek' },
  reasoningEffort: 'high',
  serviceTier: 'priority' as const,
  abortSignal: new AbortController().signal
}

type SourceReaderOptions = {
  prompt?: (turnId: string) => string
  review?: (turnId: string) => Array<{
    workflowId: string
    childId: string
    slides?: Array<{ slideId: string; revision: number; annotations?: string[] }>
  }>
  attachmentIds?: string[]
  fileReferences?: Array<{ path: string; relativePath: string; name: string; kind?: 'file' | 'directory' }>
  surface?: 'code' | 'write' | 'design'
  steeringPrompt?: string
  missing?: boolean
}

export function makePptSourceReader(options: SourceReaderOptions = {}): PptAgentTurnReader {
  return {
    getTurn: async (threadId, turnId): Promise<Turn | null> => {
      if (options.missing) return null
      const prompt = options.prompt?.(turnId) ??
        `exact user request for ${turnId}; skip direction options and directly generate`
      const composerContexts = (options.review?.(turnId) ?? []).map((review, index) => ({
        schemaVersion: 1 as const,
        id: `preview-ppt-review-${String(index + 1).padStart(24, '0')}`,
        title: 'PPT review',
        summary: 'Structured PPT review selection',
        reference: {
          kind: 'ppt-review',
          schemaVersion: 1,
          workflowId: review.workflowId,
          childId: review.childId,
          slides: review.slides ?? [{ slideId: 'slide-1', revision: 1 }]
        },
        revision: 1,
        generation: 1,
        attachmentId: `dev-preview-context:${String(index + 1).repeat(64).slice(0, 64)}`,
        provenance: { source: 'dev-preview' as const, workspaceId: 'a'.repeat(64) }
      }))
      const userItem = {
        id: `item_${turnId}_user`, turnId, threadId, kind: 'user_message', role: 'user',
        status: 'completed', text: prompt, displayText: prompt,
        attachmentIds: options.attachmentIds ?? [], composerContexts,
        fileReferences: options.fileReferences ?? [], createdAt: '2026-07-08T00:00:00.000Z'
      }
      return TurnSchema.parse({
        id: turnId,
        threadId,
        status: 'running',
        prompt,
        attachmentIds: options.attachmentIds ?? [],
        composerContexts,
        agentSurface: options.surface ?? 'code',
        items: options.steeringPrompt
          ? [{ ...userItem }, {
              ...userItem,
              id: `${userItem.id}_steering`,
              text: options.steeringPrompt,
              displayText: options.steeringPrompt
            }]
          : [userItem],
        createdAt: '2026-07-08T00:00:00.000Z'
      })
    }
  }
}

export function makePptTool(
  runtime: DelegationRuntime,
  config: () => PptAgentToolConfig | undefined,
  turns: PptAgentTurnReader = makePptSourceReader()
) {
  return buildPptAgentToolProvider(runtime, config, turns)[0].tools[0]
}

export function pptReviewBundle(
  childId: string,
  workflowId = 'ppt_workflow',
  previewMode = 'editable'
) {
  return {
    workflowId,
    childId,
    manifestPath: `.kun/ppt/${workflowId}/.kun-ppt-review/manifest.json`,
    previewMode,
    deckTitle: 'Launch deck',
    styleFingerprint: 'style-1',
    designGovernance: {
      policyVersion: '1.0.0', policyHash: 'b'.repeat(64), category: 'business-plan',
      categoryGuide: 'slides_categories/business_plan.md', planFingerprint: 'a'.repeat(64), planRevision: 1
    },
    phase: 'awaiting_review',
    slides: [{
      slideId: 'slide-1', index: 0, title: 'Opening', previewPath: '.kun/images/opening.png',
      revision: 1, status: 'ready'
    }]
  }
}

export function governedPptWorkflowId(input: { controlPrompt?: string }): string {
  const workflowId = /workflowId=([^;\s]+)/.exec(input.controlPrompt ?? '')?.[1]
  if (!workflowId) throw new Error('missing governed workflow id in child control prompt')
  return workflowId
}
