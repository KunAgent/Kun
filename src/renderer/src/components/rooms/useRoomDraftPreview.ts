import { useEffect, useState } from 'react'
import { readBrowserStorageItem } from '../../lib/browser-storage'

export function readRoomDraftPreview(roomId?: string): { body: string; attachmentCount: number } | null {
  if (!roomId) return null
  try {
    const draft = JSON.parse(readBrowserStorageItem('kun.rooms.draft.' + roomId) ?? 'null')
    const body = typeof draft?.body === 'string' ? draft.body.replace(/\s+/g, ' ').trim().slice(0, 180) : ''
    const attachmentCount = Array.isArray(draft?.attachments) ? draft.attachments.length : 0
    return body || attachmentCount ? { body, attachmentCount } : null
  } catch { return null }
}
export function useRoomDraftPreview(roomId?: string) {
  const [draft, setDraft] = useState(() => readRoomDraftPreview(roomId))
  useEffect(() => {
    const refresh = (event?: Event) => {
      const target = (event as CustomEvent<{ roomId?: string }> | undefined)?.detail?.roomId
      if (!target || target === roomId) setDraft(readRoomDraftPreview(roomId))
    }
    refresh()
    window.addEventListener('kun-room-draft-updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('kun-room-draft-updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [roomId])
  return draft
}
