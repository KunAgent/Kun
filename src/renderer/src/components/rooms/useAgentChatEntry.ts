import { useEffect, useRef, useState } from 'react'
import type { AgentChatEntry } from '@shared/rooms-api'
import { readBrowserStorageItem } from '../../lib/browser-storage'
import { roomRequestId, roomsRequest } from './rooms-client'

export function useAgentChatEntry(onOpen: (id: string) => void, navigationSerial: { current: number }) {
  const open = useRef(onOpen); open.current = onOpen
  const [error, setError] = useState(''), [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    const initialSerial = navigationSerial.current
    const initialize = async () => {
      const entry = await roomsRequest<AgentChatEntry>('/v1/agents/chat-entry', 'POST', { action: 'initialize', clientRequestId: roomRequestId() })
      if (!active || entry.seen || !entry.roomId) return
      const selected = readBrowserStorageItem('kun.rooms.selected')
      let editing = false
      try {
        const draft = JSON.parse(readBrowserStorageItem('kun.rooms.draft.' + selected) ?? '{}')
        editing = Boolean(draft.body || draft.attachments?.length || draft.references?.length)
      } catch { /* Invalid old drafts do not prevent entering chat. */ }
      if (!editing && initialSerial === navigationSerial.current) open.current(entry.roomId)
      await roomsRequest('/v1/agents/chat-entry', 'POST', { action: 'seen', clientRequestId: roomRequestId() })
    }
    setError('')
    void initialize().catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [version, navigationSerial])
  return { error, retry: () => setVersion((value) => value + 1) }
}
