import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppLocale } from '@shared/app-locales'
import type { DailyNotesApi } from '@shared/daily-notes'
import {
  closeDockedDailyNotes,
  getDailyNotesInProcessHandlers,
  popoutDockedDailyNotes,
  setDailyNotesDockWidth,
  subscribeDockedDailyNoteSummaries,
  useDailyNotesDockState
} from './dock-state'
import { DailyNotesView } from './view'
import './notes.css'

function currentWorkbenchTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ||
    document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'light'
}

export function DailyNotesDockedColumn() {
  const dock = useDailyNotesDockState()
  const { i18n } = useTranslation('common')
  const [theme, setTheme] = useState<'dark' | 'light'>(currentWorkbenchTheme)

  const bridge = typeof window !== 'undefined' && !window.kunGui?.isRemoteWeb
    ? window.kunGui?.dailyNotes
    : undefined

  useEffect(() => {
    if (!dock.open || typeof document === 'undefined') return
    setTheme(currentWorkbenchTheme())
    const observer = new MutationObserver(() => setTheme(currentWorkbenchTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [dock.open])

  const locale = (i18n.resolvedLanguage ?? i18n.language ?? 'zh').split('-')[0] as AppLocale

  const api = useMemo<DailyNotesApi | null>(() => {
    if (!bridge) return null
    return {
      context: async () => ({
        locale,
        theme,
        pinned: false,
        canPin: false
      }),
      listDays: () => bridge.listDays(),
      read: day => bridge.read(day),
      save: (day, markdown, expectedRevision) => bridge.save(day, markdown, expectedRevision),
      setPinned: async () => false,
      onCloseRequest: () => () => undefined,
      rollover: (fromDay, toDay) => bridge.rollover(fromDay, toDay),
      sendToKun: async request => {
        const handlers = getDailyNotesInProcessHandlers()
        return handlers ? handlers.sendToKun(request) : { ok: false, error: 'Workbench unavailable' }
      },
      startThread: async request => {
        const handlers = getDailyNotesInProcessHandlers()
        return handlers ? handlers.startThread(request) : { ok: false, error: 'Workbench unavailable' }
      },
      listTargets: async () => {
        const handlers = getDailyNotesInProcessHandlers()
        return handlers ? handlers.listTargets() : { activeWorkspaceRoot: '', projects: [], threads: [] }
      },
      openLink: async url => {
        const handlers = getDailyNotesInProcessHandlers()
        return handlers ? handlers.openLink(url) : false
      },
      watchLinks: async urls => {
        const handlers = getDailyNotesInProcessHandlers()
        return handlers ? handlers.watchLinks(urls) : {}
      },
      onExternalChange: listener => bridge.onExternalChange(listener),
      onLinkSummaries: listener => subscribeDockedDailyNoteSummaries(listener)
    }
  }, [bridge, locale, theme])

  if (!dock.open || !api) return null

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = dock.width
    const onMove = (moveEvent: PointerEvent): void => {
      setDailyNotesDockWidth(startWidth + (moveEvent.clientX - startX))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside
      className="note-docked-shell ds-no-drag"
      data-theme={theme}
      style={{ width: `${dock.width}px` }}
    >
      <DailyNotesView
        key={locale}
        api={api}
        surface="docked"
        targetDay={dock.targetDay}
        targetViewMode={dock.targetViewMode}
        focusNonce={dock.focusNonce}
        onPopout={() => void popoutDockedDailyNotes()}
        onCloseDocked={closeDockedDailyNotes}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        className="note-dock-resizer"
        onPointerDown={beginResize}
      />
    </aside>
  )
}
