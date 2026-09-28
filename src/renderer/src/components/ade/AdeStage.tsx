import { lazy, Suspense, type ReactElement } from 'react'
import {
  WorkbenchConversationStage,
  type WorkbenchConversationStageProps
} from '../workbench/WorkbenchConversationStage'

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
 * Code-only surface. The shared ActivityStore feed (06 §9) is app-owned in
 * AppShell while the ADE lab flag is on, so this stage only subscribes.
 */
export function AdeStage({ conversation, activeThreadId }: AdeStageProps): ReactElement {
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
