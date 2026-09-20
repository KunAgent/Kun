import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoomPresentationPreferences } from './room-presentation-preferences'

export function RoomPanelResizeHandle({ side }: { side: 'list' | 'detail' }) {
  const { t } = useTranslation('common')
  const prefs = useRoomPresentationPreferences()
  const key = side === 'list' ? 'listWidth' : 'detailWidth'
  const min = side === 'list' ? 240 : 360, max = side === 'list' ? 520 : 640
  const stop = useRef<() => void>(() => {})
  useEffect(() => () => stop.current(), [])
  return <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t(side === 'list' ? 'roomsResizeList' : 'roomsResizeDetails')}
    aria-valuenow={Math.round(prefs[key])} aria-valuemin={min} aria-valuemax={max}
    className={`rooms-panel-resize rooms-panel-resize-${side}`} onPointerDown={(event) => {
      event.preventDefault(); stop.current()
      const initialX = event.clientX, initialWidth = prefs[key]
      const move = (next: PointerEvent) => prefs.setPreference({ [key]: initialWidth + (next.clientX - initialX) * (side === 'list' ? 1 : -1) })
      const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
      stop.current = end
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
    }} onKeyDown={(event) => {
      const direction = side === 'list' ? 1 : -1
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); prefs.setPreference({ [key]: prefs[key] + (event.key === 'ArrowRight' ? 1 : -1) * direction * (event.shiftKey ? 32 : 8) })
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); prefs.setPreference({ [key]: event.key === 'Home' ? min : max })
      }
    }} />
}
