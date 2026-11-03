import type { ReactElement } from 'react'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'
import { steerDelivery } from '../../agent/harness-capability-ui'
import { useChatStore } from '../../store/chat-store'
import { ComposerTrayHost } from './composer-tray/ComposerTrayHost'
import { FloatingComposerGoalPanel } from './FloatingComposerGoalPanel'
import { FloatingComposerSurfaceView } from './FloatingComposerSurfaceView'

/**
 * The whole composer stack: popover menus (absolutely positioned above it),
 * the goal panel, and the surface (controls, activity tray, input slot).
 */
export function FloatingComposerStackView({
  context
}: {
  context: FloatingComposerRenderContext
}): ReactElement {
  const {
    FloatingComposerAboveInputStack, FloatingComposerActionMenu,
    FloatingComposerFileMentionMenu, FloatingComposerQueuedMessages, FloatingComposerSlashCommandMenu,
    activeThreadId, applySlashCommand, busy, composerMenuOpen,
    currentTurnOrchestration, draft, fileMentions, filteredSlashCommands, highlightedSlashCommand,
    onReorderQueuedMessage, onResumeQueuedMessages, onGuideQueuedMessage, onRemoveQueuedMessage,
    onRestoreQueuedMessageToComposer, queuedMessages, route, slashCommandMenu, slashQuery
  } = context
  // Only the running turn's own runtime report says how guidance reaches it.
  const steering = useChatStore((s) => {
    const runtime = s.lastDelegatedRuntimeState
    return runtime && runtime.threadId === activeThreadId && runtime.turnId === s.currentTurnId
      ? steerDelivery(runtime) : 'live'
  })
  const queue = queuedMessages?.length ? (
    <FloatingComposerQueuedMessages
      messages={queuedMessages}
      running={busy}
      guidanceTarget={currentTurnOrchestration === 'graph' ? 'graph' : steering === 'live' ? 'turn' : steering}
      onRemove={onRemoveQueuedMessage}
      onGuide={onGuideQueuedMessage}
      onRestoreToComposer={onRestoreQueuedMessageToComposer
        ? async (id: string) => {
            const restored = await onRestoreQueuedMessageToComposer(id)
            if (restored !== false) draft.focusComposer()
            return restored
          }
        : undefined}
      onReorder={onReorderQueuedMessage}
      onResume={onResumeQueuedMessages}
    />
  ) : null
  // The kind hooks live in the host so their updates re-render only the tray.
  const tray = <ComposerTrayHost context={context} queue={queue} />
  return (
    <>
      {composerMenuOpen && slashQuery == null ? (
        <FloatingComposerActionMenu context={context} />
      ) : null}

      {slashQuery != null ? (
        <FloatingComposerSlashCommandMenu
          commands={filteredSlashCommands}
          highlighted={highlightedSlashCommand}
          selectedIndex={slashCommandMenu.selectedIndex}
          onSelect={applySlashCommand}
        />
      ) : null}

      {fileMentions.showMenu ? (
        <FloatingComposerFileMentionMenu
          suggestions={fileMentions.suggestions}
          loading={fileMentions.loading}
          selectedIndex={fileMentions.selectedIndex}
          highlighted={fileMentions.highlighted}
          hasMountedKnowledgeBases={fileMentions.hasMountedKnowledgeBases}
          knowledgeBaseHint={route !== 'write'}
          onSelect={fileMentions.applySuggestion}
        />
      ) : null}

      <FloatingComposerGoalPanel context={context} />

      <FloatingComposerSurfaceView
        context={context}
        aboveInput={<FloatingComposerAboveInputStack tray={tray} />}
      />
    </>
  )
}
