import type { GuiDesignArtifactContextJson, GuiPlanContextJson, Turn, TurnReasoningEffort, TurnStatus } from '../contracts/turns.js'
import type { ThreadMode } from '../contracts/threads.js'
import type { TurnItem } from '../contracts/items.js'
import type { ComposerContextAttachmentJson } from '../contracts/composer-context.js'

export type TurnEntity = Turn

export function createTurnRecord(input: {
  id: string
  threadId: string
  prompt: string
  model?: string
  providerId?: string
  accountId?: string
  reasoningEffort?: TurnReasoningEffort
  attachmentIds?: string[]
  composerContexts?: ComposerContextAttachmentJson[]
  guiPlan?: GuiPlanContextJson
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: GuiDesignArtifactContextJson
  mode?: ThreadMode
  disableUserInput?: boolean
  imContext?: boolean
  workspaceCheckpointId?: string
  extensionBudgetTokenBaseline?: number
  createdAt?: string
  status?: TurnStatus
}): TurnEntity {
  const model = input.model?.trim()
  const providerId = input.providerId?.trim()
  const accountId = input.accountId?.trim()
  const reasoningEffort = normalizeReasoningEffort(input.reasoningEffort)
  return {
    id: input.id,
    threadId: input.threadId,
    status: input.status ?? 'queued',
    prompt: input.prompt,
    steering: [],
    items: [],
    attachmentIds: [...(input.attachmentIds ?? [])],
    composerContexts: [...(input.composerContexts ?? [])],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedInstructionSources: [],
    ...(model ? { model } : {}),
    ...(providerId ? { providerId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(input.guiPlan ? { guiPlan: input.guiPlan } : {}),
    ...(input.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
    ...(input.guiDesignMode ? { guiDesignMode: true } : {}),
    ...(input.guiDesignArtifact ? { guiDesignArtifact: input.guiDesignArtifact } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.disableUserInput ? { disableUserInput: true } : {}),
    ...(input.imContext ? { imContext: true } : {}),
    ...(input.workspaceCheckpointId ? { workspaceCheckpointId: input.workspaceCheckpointId } : {}),
    ...(input.extensionBudgetTokenBaseline !== undefined
      ? {
          extensionBudgetTokenBaseline: input.extensionBudgetTokenBaseline,
          extensionModelRequests: 0,
          extensionToolInvocations: 0
        }
      : {}),
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}

function normalizeReasoningEffort(effort: TurnReasoningEffort | undefined): TurnReasoningEffort | undefined {
  return effort && effort !== 'auto' ? effort : undefined
}

export function appendTurnItem(turn: TurnEntity, item: TurnItem): TurnEntity {
  if (turn.items.some((existing) => existing.id === item.id)) {
    return {
      ...turn,
      items: turn.items.map((existing) => (existing.id === item.id ? item : existing))
    }
  }
  return { ...turn, items: [...turn.items, item] }
}

export function replaceTurnItem(
  turn: TurnEntity,
  itemId: string,
  patch: Partial<TurnItem>
): TurnEntity {
  return {
    ...turn,
    items: turn.items.map((existing) =>
      existing.id === itemId ? ({ ...existing, ...patch } as TurnItem) : existing
    )
  }
}

export function startTurn(turn: TurnEntity, startedAt?: string): TurnEntity {
  return {
    ...turn,
    status: 'running',
    startedAt: startedAt ?? new Date().toISOString()
  }
}

export function finishTurn(
  turn: TurnEntity,
  status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>,
  finishedAt?: string
): TurnEntity {
  return {
    ...turn,
    status,
    finishedAt: finishedAt ?? new Date().toISOString(),
    steering: []
  }
}
