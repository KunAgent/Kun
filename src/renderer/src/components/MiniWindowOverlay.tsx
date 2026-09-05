import '../styles/base-shell/mini-window.css'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

function ExpandIcon(): ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M11 2h5v5M16 2l-6.2 6.2M7 16H2v-5M2 16l6.2-6.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Hover overlay shown while the window is in mini-pane mode. The dimmed layer
// itself is a window drag region so the pane can be moved freely; clicking
// the expand badge (or the title-bar mini button) restores the normal size.
export function MiniWindowOverlay(): ReactElement {
  const { t } = useTranslation('common')
  const restore = (): void => {
    if (typeof window.kunGui?.runDesktopCommand === 'function') {
      void window.kunGui.runDesktopCommand('toggleMini')
    }
  }
  return (
    <div className="ds-mini-restore">
      <div className="ds-mini-restore-controls">
        <button
          type="button"
          className="ds-mini-restore-badge"
          aria-label={t('miniWindowRestore')}
          title={t('miniWindowRestore')}
          onClick={restore}
        >
          <ExpandIcon />
          <span>{t('miniWindowRestore')}</span>
        </button>
        <span className="ds-mini-restore-hint">{t('miniWindowDragHint')}</span>
      </div>
    </div>
  )
}
