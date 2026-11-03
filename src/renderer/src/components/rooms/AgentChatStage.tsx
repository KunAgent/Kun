import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useAssistantNavigationStore } from '../assistants/assistant-navigation'
import { useAgentChatNavigationStore } from './agent-chat-navigation'
import { RoomsWorkspaceView } from './RoomsWorkspaceView'

const AssistantConversationStage = lazy(() =>
  import('../assistants/AssistantConversationStage').then((module) => ({ default: module.AssistantConversationStage })))

/** Code stage for the selected Agent private, group or Agent pair conversation, or a personal assistant. */
export function AgentChatStage({ onOpenThread, onOpenPlugins, onToggleLeftSidebar }: {
  onOpenThread: (id: string, turnId?: string) => void | Promise<void>
  onOpenPlugins: () => void
  onToggleLeftSidebar: () => void
}) {
  const { t } = useTranslation('common')
  const { roomId, error, pending } = useAgentChatNavigationStore()
  // A personal assistant opened from the conversation list takes the stage until a Room is opened.
  const assistant = useAssistantNavigationStore((state) => state.selection)
  if (assistant) return <Suspense fallback={null}>
    <AssistantConversationStage selection={assistant} onToggleLeftSidebar={onToggleLeftSidebar} />
  </Suspense>
  if (!roomId) return <section className="ds-no-drag grid min-h-0 flex-1 place-content-center p-8 text-center text-sm text-ds-muted">
    <p role={error ? 'alert' : 'status'}>{error || t(pending ? 'roomsLoading' : 'agentChatsEmptyHint')}</p>
  </section>
  return <RoomsWorkspaceView key={roomId} initialRoomId={roomId}
    onOpenThread={onOpenThread} onOpenPlugins={onOpenPlugins} onToggleLeftSidebar={onToggleLeftSidebar} />
}
