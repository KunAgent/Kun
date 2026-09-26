import type { AppSettingsV1 } from './app-settings-types'
import { normalizeModelProviderId } from './app-settings-provider-capabilities'

/**
 * Every product surface that can hold a provider reference. Used by the
 * provider list ("used by" badges) and by the delete confirmation so a
 * referenced provider is never removed silently.
 */
export type ModelProviderReferenceKind =
  | 'chat'
  | 'image'
  | 'speech'
  | 'textToSpeech'
  | 'music'
  | 'video'
  | 'write'
  | 'design'
  | 'im'
  | 'schedule'
  | 'workflow'
  | 'subagent'
  | 'fastContext'
  | 'graph'
  | 'pptAgent'
  | 'promptOptimization'
  | 'autoPlanBuild'
  | 'contextCompaction'
  | 'approvalReview'
  | 'smallModel'
  | 'titleModel'
  | 'routePool'
  | 'failover'

export type ModelProviderReference = {
  kind: ModelProviderReferenceKind
  /** Human-readable owner detail, e.g. a scheduled task title or pool name. */
  detail?: string
}

function matches(value: unknown, providerId: string): boolean {
  return typeof value === 'string' && normalizeModelProviderId(value) === providerId
}

function push(references: ModelProviderReference[], kind: ModelProviderReferenceKind, detail?: string): void {
  references.push(detail ? { kind, detail } : { kind })
}

/**
 * Lists every settings location that references `providerId`. Covers the Kun
 * default route, media services, Write/Design/IM/schedule/workflow surfaces,
 * subagent and lab model pins, route-pool targets, and failover chains.
 */
export function listModelProviderReferences(
  settings: AppSettingsV1,
  providerId: string
): ModelProviderReference[] {
  const id = normalizeModelProviderId(providerId)
  if (!id) return []
  const references: ModelProviderReference[] = []
  const kun = settings.agents?.kun as Record<string, any> | undefined
  if (matches(kun?.providerId, id)) push(references, 'chat')
  if (matches(kun?.smallModelProviderId, id)) push(references, 'smallModel')
  if (matches(kun?.titleModelProviderId, id)) push(references, 'titleModel')
  const approvalReview = kun?.approvalReview
  if (approvalReview?.mode === 'fixed' && matches(approvalReview.providerId, id)) {
    push(references, 'approvalReview')
  }
  if (matches(kun?.contextCompaction?.summaryProviderId, id)) push(references, 'contextCompaction')
  if (matches(kun?.imageGeneration?.providerId, id)) push(references, 'image')
  if (matches(kun?.speechToText?.providerId, id)) push(references, 'speech')
  if (matches(kun?.textToSpeech?.providerId, id)) push(references, 'textToSpeech')
  if (matches(kun?.musicGeneration?.providerId, id)) push(references, 'music')
  if (matches(kun?.videoGeneration?.providerId, id)) push(references, 'video')
  if (matches(kun?.promptOptimization?.providerId, id)) push(references, 'promptOptimization')
  if (matches(kun?.fastContext?.providerId, id)) push(references, 'fastContext')
  if (matches(kun?.lab?.pptAgent?.providerId, id)) push(references, 'pptAgent')
  if (matches(kun?.lab?.autoPlanBuild?.scheduledDefaults?.providerId, id)) {
    push(references, 'autoPlanBuild')
  }
  const workerModel = kun?.graph?.workerModel
  if (workerModel?.mode === 'fixed' && matches(workerModel.providerId, id)) {
    push(references, 'graph')
  }
  const subagentProfiles = kun?.subagents?.profiles
  if (Array.isArray(subagentProfiles)) {
    for (const profile of subagentProfiles) {
      if (matches(profile?.providerId, id)) {
        push(references, 'subagent', typeof profile?.name === 'string' ? profile.name : undefined)
      }
    }
  }

  const writeInline = settings.write?.inlineCompletion
  if (writeInline && writeInline.inheritProvider !== true && matches(writeInline.providerId, id)) {
    push(references, 'write')
  }
  if (matches(settings.design?.providerId, id)) push(references, 'design')

  const clawIm = settings.claw?.im
  if (matches(clawIm?.providerId, id)) push(references, 'im')
  const clawChannels = settings.claw?.channels
  if (Array.isArray(clawChannels)) {
    for (const channel of clawChannels) {
      if (matches(channel?.providerId, id)) {
        push(references, 'im', typeof channel?.label === 'string' && channel.label.trim()
          ? channel.label.trim()
          : channel?.id)
      }
      const conversations = channel?.conversations
      if (Array.isArray(conversations) &&
          conversations.some((conversation) => matches(conversation?.providerId, id))) {
        push(references, 'im')
      }
    }
  }

  const schedule = settings.schedule
  if (matches(schedule?.providerId, id)) push(references, 'schedule')
  const tasks = schedule?.tasks
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (matches(task?.providerId, id)) {
        push(references, 'schedule', typeof task?.title === 'string' && task.title.trim()
          ? task.title.trim()
          : task?.id)
      }
    }
  }

  const workflow = settings.workflow
  if (matches(workflow?.providerId, id)) push(references, 'workflow')
  const workflows = workflow?.workflows
  if (Array.isArray(workflows)) {
    for (const flow of workflows) {
      const nodes = flow?.nodes
      if (!Array.isArray(nodes)) continue
      const hit = nodes.some((node) =>
        matches((node?.config as { providerId?: string } | undefined)?.providerId, id))
      if (hit) {
        push(references, 'workflow', typeof flow?.name === 'string' && flow.name.trim()
          ? flow.name.trim()
          : flow?.id)
      }
    }
  }

  const provider = settings.provider
  for (const pool of provider?.routePools ?? []) {
    if (pool.targets?.some((target) => matches(target?.providerId, id))) {
      push(references, 'routePool', pool.name || pool.id)
    }
  }
  for (const group of provider?.failover ?? []) {
    if (matches(group.providerId, id) ||
        group.accounts?.some((account) => matches(account.providerId, id))) {
      push(references, 'failover')
    }
    if (group.fallbackTargets?.some((target) => matches(target.providerId, id))) {
      push(references, 'failover')
    }
  }
  return references
}

/** Distinct reference kinds for badge display. */
export function modelProviderReferenceKinds(
  settings: AppSettingsV1,
  providerId: string
): ModelProviderReferenceKind[] {
  return [...new Set(listModelProviderReferences(settings, providerId).map((ref) => ref.kind))]
}
