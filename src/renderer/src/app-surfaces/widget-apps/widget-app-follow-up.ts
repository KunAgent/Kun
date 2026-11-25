import type { WidgetAppFollowUp } from '@shared/widget-apps'
import { useChatStore } from '../../store/chat-store'
import { attachAppSurfaceContext, threadWorkspaceRoot } from '../app-surface-composer-context'
import i18n from '../../i18n'

export async function sendWidgetAppFollowUp(request: WidgetAppFollowUp): Promise<boolean> {
  const { threadId, prompt, title, modelContent } = request
  const store = useChatStore.getState()
  store.setRoute('chat')
  await store.selectThread(threadId)
  if (useChatStore.getState().activeThreadId !== threadId) return false
  if (modelContent != null) {
    await attachAppSurfaceContext({ threadId, workspaceRoot: threadWorkspaceRoot(threadId),
      key: 'widget-app:' + request.requestId, kind: 'gen-ui-state', label: title, data: modelContent,
      title: i18n.t('common:appSurfaceWidgetStateChip', { title }), summary: i18n.t('common:appSurfaceWidgetStateSummary') })
  }
  return useChatStore.getState().sendMessage(prompt, 'agent', { expectedThreadId: threadId })
}
