import { useEffect, useRef, useState } from 'react'
import { ListTree } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomMessage, RoomMessageRunSource } from '@shared/rooms-api'
import { roomPath, roomsRequest } from './rooms-client'

export function RoomMessageRunButton({
  message,
  onRun
}: {
  message: RoomMessage
  onRun: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const open = async () => {
    if (message.originRunId) {
      onRun(message.originRunId)
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await roomsRequest<RoomMessageRunSource>(
        `${roomPath(message.roomId)}/messages/${encodeURIComponent(message.id)}/run`,
        'GET',
        undefined,
        controller.signal
      )
      if (controller.signal.aborted) return
      if (result.runId) onRun(result.runId)
      else setError(result.unavailableReason || t('roomsRunSourceUnavailable'))
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <span className="rooms-message-run-source">
      <button
        type="button"
        className="rooms-message-task"
        disabled={busy}
        onClick={() => void open()}
      >
        <ListTree size={13} />
        {t(busy ? 'roomsLoading' : 'roomsViewRun')}
      </button>
      {error ? (
        <span role="alert" className="rooms-run-error">
          {error}
        </span>
      ) : null}
    </span>
  )
}
