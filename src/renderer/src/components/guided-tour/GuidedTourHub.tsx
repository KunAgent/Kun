import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Briefcase, Code2, Compass, MessagesSquare, X } from 'lucide-react'
import { readTourSeen, useGuidedTourStore } from './guided-tour-store'
import { GUIDED_TOURS, GUIDED_TOURS_BUTTON, openGuidedMode, type GuidedTourId } from './guided-tour-steps'

const ROWS: { id: GuidedTourId; Icon: typeof Compass }[] = [
  { id: 'overview', Icon: Compass },
  { id: 'code', Icon: Code2 },
  { id: 'work', Icon: Briefcase },
  { id: 'chats', Icon: MessagesSquare }
]

/** The ? list: every tour with whether it was seen, each one restartable. */
export function GuidedTourHub(): ReactElement {
  const { t } = useTranslation('common')
  const setHubOpen = useGuidedTourStore((s) => s.setHubOpen)
  const panelRef = useRef<HTMLElement | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>({ left: 12, bottom: 64 })
  const close = (): void => setHubOpen(false)

  useLayoutEffect(() => {
    const button = document.querySelector(GUIDED_TOURS_BUTTON)
    if (!button) return
    const zoom = document.body.getBoundingClientRect().width / Math.max(1, document.body.clientWidth) || 1
    const rect = button.getBoundingClientRect()
    setAnchor({ left: Math.max(12, rect.left / zoom - 12), bottom: Math.max(12, window.innerHeight / zoom - rect.top / zoom + 8) })
  }, [])

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button[data-guided-tour-run]')?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setHubOpen(false)
    }
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (panelRef.current?.contains(target) || (target instanceof Element && target.closest(GUIDED_TOURS_BUTTON))) return
      setHubOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPointer, true) }
  }, [setHubOpen])

  const run = (id: GuidedTourId): void => {
    const store = useGuidedTourStore.getState()
    store.setHubOpen(false)
    store.request(id)
    const mode = GUIDED_TOURS[id].mode
    if (mode) openGuidedMode(mode)
  }

  const seenCount = ROWS.filter((row) => readTourSeen(row.id)).length
  return createPortal(
    <section ref={panelRef} className="guided-tour-hub" role="dialog" aria-labelledby="guided-tour-hub-title"
      data-guided-tour-hub style={{ left: anchor.left, bottom: anchor.bottom }}>
      <header className="guided-tour-hub-head">
        <h2 id="guided-tour-hub-title">{t('guidedTourHubTitle')}</h2>
        <span className="guided-tour-hub-count">{t('guidedTourHubSeen', { seen: seenCount, total: ROWS.length })}</span>
        <button type="button" className="guided-tour-close is-inline" aria-label={t('guidedTourClose')} onClick={close}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>
      <ul className="guided-tour-hub-list">
        {ROWS.map(({ id, Icon }) => {
          const seen = readTourSeen(id)
          return (
            <li key={id} className="guided-tour-hub-row" data-guided-tour-row={id} data-seen={seen ? 'true' : 'false'}>
              <span className="guided-tour-hub-icon"><Icon size={16} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="guided-tour-hub-text">
                <span className="guided-tour-hub-name">{t(`guidedTourHub_${id}`)}</span>
                <span className="guided-tour-hub-sub">{t(`guidedTourHub_${id}_sub`)}</span>
              </span>
              <button type="button" className="guided-tour-button is-small" data-guided-tour-run={id} onClick={() => run(id)}>
                {t(seen ? 'guidedTourHubReplay' : 'guidedTourHubStart')}
              </button>
            </li>
          )
        })}
      </ul>
    </section>,
    document.body
  )
}
