import { useTranslation } from 'react-i18next'
import { useAgentChatNavigationStore } from './agent-chat-navigation'
import { RoomsWorkspaceView } from './RoomsWorkspaceView'

/** Code stage for the selected Agent private, group or Agent pair conversation. */
export function AgentChatStage({ onOpenThread, onOpenPlugins, onToggleLeftSidebar }: {
  onOpenThread: (id: string, turnId?: string) => void | Promise<void>
  onOpenPlugins: () => void
  onToggleLeftSidebar: () => void
}) {
  const { t } = useTranslation('common')
  const { roomId, error, pending } = useAgentChatNavigationStore()
  if (!roomId) return <section className="ds-no-drag grid min-h-0 flex-1 place-content-center p-8 text-center text-sm text-ds-muted">
    <p role={error ? 'alert' : 'status'}>{error || t(pending ? 'roomsLoading' : 'agentChatsEmptyHint')}</p>
  </section>
  return <RoomsWorkspaceView key={roomId} initialRoomId={roomId}
    onOpenThread={onOpenThread} onOpenPlugins={onOpenPlugins} onToggleLeftSidebar={onToggleLeftSidebar} />
}
