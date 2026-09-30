import { lazy, Suspense, type ReactElement } from 'react'
import {
  WorkbenchConversationStage,
  type WorkbenchConversationStageProps
} from '../workbench/WorkbenchConversationStage'

const AdeMissionControl = lazy(() =>
  import('./AdeMissionControl').then((module) => ({ default: module.AdeMissionControl }))
)
const TerminalDrawer = lazy(() =>
  import('../terminal/TerminalDrawer').then((module) => ({ default: module.TerminalDrawer }))
)

export type AdeStageProps = {
  conversation: WorkbenchConversationStageProps
  activeThreadId: string | null
  adeDraftOpen: boolean
}

/**
 * ADE mode reuses the Code conversation stage (composer, timeline, right
 * panel host) through `mode="ade"` — it does not copy the chat UI. With no
 * active thread or draft the ADE home is Mission Control; SDD editing stays a
 * Code-only surface. The shared ActivityStore feed (06 §9) is app-owned in
 * AppShell while the ADE lab flag is on, so this stage only subscribes.
 *
 * P4-09: the agent home carries the shared terminal drawer too — harness
 * install/login actions from the Agent Center open a prefilled local tab
 * here, outside any conversation.
 */
export function AdeStage({ conversation, activeThreadId, adeDraftOpen }: AdeStageProps): ReactElement {
  if (!activeThreadId && !adeDraftOpen) {
    const {
      terminalOpen,
      terminalHeight,
      terminalWorkspaceRoot,
      onBeginTerminalResize,
      onToggleTerminal
    } = conversation.chat
    return (
      <section
        className="ds-chat-stage ds-drag relative isolate flex min-h-0 min-w-0 flex-1 flex-col"
        data-terminal-open={terminalOpen ? 'true' : 'false'}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Suspense fallback={<div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />}>
            <AdeMissionControl />
          </Suspense>
        </div>
        {terminalOpen ? (
          <Suspense fallback={null}>
            <TerminalDrawer
              workspaceRoot={terminalWorkspaceRoot}
              height={terminalHeight}
              onBeginResize={onBeginTerminalResize}
              onCollapse={onToggleTerminal}
            />
          </Suspense>
        ) : null}
      </section>
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
