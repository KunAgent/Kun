import { lazy, Suspense, useEffect, type ReactElement } from 'react'
import {
  WorkbenchConversationStage,
  type WorkbenchConversationStageProps
} from '../workbench/WorkbenchConversationStage'
import { startActivityFeed, stopActivityFeed } from '../../store/activity-store'

const AdeMissionControl = lazy(() =>
  import('./AdeMissionControl').then((module) => ({ default: module.AdeMissionControl }))
)

export type AdeStageProps = {
  conversation: WorkbenchConversationStageProps
  activeThreadId: string | null
}

/**
 * ADE mode reuses the Code conversation stage (composer, timeline, right
 * panel host) through `mode="ade"` — it does not copy the chat UI. With no
 * active thread the ADE home is Mission Control; SDD draft editing stays a
 * Code-only surface.
 */
export function AdeStage({ conversation, activeThreadId }: AdeStageProps): ReactElement {
  // The shared ActivityStore feed (06 §9) powers Mission Control, the
  // sidebar needs-you count, and later ADE surfaces; it lives as long as
  // ADE mode is mounted and releases its long-poll when the user leaves.
  useEffect(() => {
    startActivityFeed()
    return () => stopActivityFeed()
  }, [])

  if (!activeThreadId) {
    return (
      <Suspense fallback={<div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />}>
        <AdeMissionControl />
      </Suspense>
    )
  }
  return (
    <WorkbenchConversationStage
      {...conversation}
      mode="ade"
      activeSddDraft={false}
    />
  )
}
