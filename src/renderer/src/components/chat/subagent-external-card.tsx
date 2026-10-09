import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { Info } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import {
  EXTERNAL_SUBAGENT_SOURCE_LABELS,
  rememberExternalSubagentChild,
  type ExternalSubagentView
} from '../../agent/external-subagent'
import type { DelegateDetail } from './subagent-call-card-support'

/** The external-Agent view the mapper attached to a subagent tool block, if any. */
export function readExternalSubagentView(block: ChatBlock): ExternalSubagentView | undefined {
  if (block.kind !== 'tool') return undefined
  const value = block.meta?.externalSubagent
  if (!value || typeof value !== 'object') return undefined
  const view = value as ExternalSubagentView
  rememberExternalSubagentChild(view)
  return view
}

/**
 * Fold the external view into the delegate detail the card already renders,
 * so title, summary, error, steps and timing need no separate code path.
 */
export function mergeExternalDetail(detail: DelegateDetail, view: ExternalSubagentView | undefined): DelegateDetail {
  if (!view) return detail
  return {
    ...detail,
    ...(view.childThreadId ? { childId: view.childThreadId } : {}),
    ...(view.label ? { title: view.label } : {}),
    ...(view.summary ? { summary: view.summary } : {}),
    ...(view.error ? { error: view.error } : {}),
    ...(view.profile ? { profile: view.profile } : {}),
    ...(view.model ? { model: view.model } : {}),
    ...(view.steps !== undefined ? { toolInvocations: view.steps } : {}),
    ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
    ...(view.totalTokens !== undefined ? { totalTokens: view.totalTokens } : {}),
    ...(view.detached ? { detached: true } : {})
  }
}

/** "explore · OpenCode": the Agent's own type name plus where it runs. */
export function externalAgentIdentity(view: ExternalSubagentView): string {
  const source = EXTERNAL_SUBAGENT_SOURCE_LABELS[view.source]
  return view.profile ? `${view.profile} · ${source}` : source
}

/** Pose key that never borrows Kun's own subagent figures for another Agent. */
export function externalPoseId(view: ExternalSubagentView): string {
  return `${view.source}:${view.profile ?? 'agent'}`
}

export function externalNotice(view: ExternalSubagentView, t: TFunction<'common'>): string | undefined {
  const source = EXTERNAL_SUBAGENT_SOURCE_LABELS[view.source]
  if (view.awaitingPermission === 'native') {
    return t('externalSubagentAwaitingNative', { agent: source, defaultValue: 'Waiting for a permission in {{agent}}; Kun cannot approve it' })
  }
  if (view.endedWithTurn) {
    return t('externalSubagentEndedWithTurn', { defaultValue: 'The turn ended before it finished' })
  }
  if (view.closedByParent) {
    return t('externalSubagentClosedByParent', { defaultValue: 'Closed by the main agent' })
  }
  if (view.unavailableReason) return view.unavailableReason
  if (view.progressChecks) {
    return t('externalSubagentProgressChecks', { count: view.progressChecks, defaultValue: 'The main agent checked progress {{count}} times' })
  }
  if (!view.childThreadId) {
    return t('externalSubagentNoProcess', { agent: source, defaultValue: '{{agent}} does not share this subagent’s steps' })
  }
  return undefined
}

export function ExternalSubagentNotice({
  view,
  t
}: {
  view: ExternalSubagentView | undefined
  t: TFunction<'common'>
}): ReactElement | null {
  const notice = view ? externalNotice(view, t) : undefined
  if (!notice) return null
  return (
    <span
      className="mt-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-ds-faint"
      data-testid="external-subagent-notice"
    >
      <Info className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="truncate" title={notice}>{notice}</span>
    </span>
  )
}
