import { useTranslation } from 'react-i18next'
import { useFirstRoomTask } from './first-task-prompt'
import { trackProduct } from './client'
export function FirstRoomTask({ roomId }: { roomId: string }) {
  const requested = useFirstRoomTask(s => s.requested), { i18n } = useTranslation()
  if (!requested) return null
  const zh = i18n.language.startsWith('zh')
  return <div className="my-3 flex flex-wrap items-center gap-3" data-first-room-task>
    <button type="button" onClick={() => {
      window.dispatchEvent(new CustomEvent('kun-room-example', { detail: { roomId, body: zh
        ? '请帮我把目标拆成三个可执行步骤。在给方案前，请先向我确认目标、时间和限制。'
        : 'Help me break a goal into three actionable steps. Before proposing a plan, ask me about my goal, timeline and constraints.' } }))
      useFirstRoomTask.setState({ requested: false })
      trackProduct({ name: 'onboarding_step', properties: { step: 'first_task', action: 'completed', mode: 'room' } })
    }}>{zh ? '准备目标拆解问题（不会自动发送）' : 'Prepare a goal prompt (send it yourself)'}</button>
    <button type="button" onClick={() => useFirstRoomTask.setState({ requested: false })}>{zh ? '跳过' : 'Skip'}</button>
  </div>
}
