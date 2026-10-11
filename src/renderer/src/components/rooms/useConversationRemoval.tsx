import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ConversationRemovalDialog } from './ConversationRemovalDialog'
import { leaveAgentConversation } from './agent-chat-navigation'
import {
  conversationRemovalError,
  removeConversation,
  type ConversationRemoval,
  type ConversationRemovalTarget
} from './agent-chat-removal'

/**
 * Removal requested from inside an open conversation (header menu or info
 * board). A confirmed removal leaves the conversation; the Code list follows
 * the runtime's room and Agent events.
 */
export function useConversationRemoval(): {
  request: (target: ConversationRemovalTarget, removal: ConversationRemoval) => void
  dialog: ReactNode
} {
  const { t } = useTranslation('common')
  const [pending, setPending] = useState<{ target: ConversationRemovalTarget; removal: ConversationRemoval } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const confirm = async (): Promise<void> => {
    if (!pending || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await removeConversation(pending.target, pending.removal)
      leaveAgentConversation(pending.target.roomId)
      setPending(null)
    } catch (cause) {
      setError(conversationRemovalError(cause, t))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return {
    request: (target, removal) => { setError(''); setPending({ target, removal }) },
    dialog: pending ? <ConversationRemovalDialog target={pending.target} removal={pending.removal} busy={busy} error={error}
      onCancel={() => { if (!busy) { setPending(null); setError('') } }} onConfirm={() => void confirm()} /> : null
  }
}
