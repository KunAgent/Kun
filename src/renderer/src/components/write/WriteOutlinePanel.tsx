import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useWriteEditorBridge } from '../../write/write-editor-bridge'
import { WriteRightPanelEmpty, WriteRightPanelHeader } from './WriteRightPanelHeader'

export function WriteOutlinePanel({ onCollapse }: { onCollapse: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const { outline, activeSlug, commands, floatingOutline, setFloatingOutline } = useWriteEditorBridge(
    useShallow((state) => ({
      outline: state.outline,
      activeSlug: state.activeHeadingSlug,
      commands: state.commands,
      floatingOutline: state.floatingOutline,
      setFloatingOutline: state.setFloatingOutline
    }))
  )
  const topLevel = outline.length > 0 ? Math.min(...outline.map((entry) => entry.level)) : 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WriteRightPanelHeader id="outline" onCollapse={onCollapse} />
      {!commands ? (
        <WriteRightPanelEmpty>{t('workOutlineUnavailable')}</WriteRightPanelEmpty>
      ) : outline.length === 0 ? (
        <WriteRightPanelEmpty>{t('workOutlineEmpty')}</WriteRightPanelEmpty>
      ) : (
        <nav aria-label={t('workRailOutline')} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-3.5">
          <div className="px-2 pb-2.5 text-[12px] text-ds-faint">
            {t('workOutlineSummary', { count: outline.length })}
          </div>
          {outline.map((entry) => {
            const depth = Math.min(Math.max(entry.level - topLevel, 0), 4)
            const active = entry.slug === activeSlug
            return (
              <button
                key={`${entry.slug}-${entry.pos}`}
                type="button"
                onClick={() => commands.jumpToHeading(entry.pos)}
                aria-current={active ? 'location' : undefined}
                className={`write-outline-panel-item ${active ? 'is-active' : ''} ${depth === 0 ? 'is-top' : ''}`}
                style={{ paddingLeft: 10 + depth * 14 }}
              >
                {depth > 0 ? <span aria-hidden="true" className="write-outline-panel-dot" /> : null}
                <span className="min-w-0 truncate">{entry.text}</span>
              </button>
            )
          })}
        </nav>
      )}
      <label className="mx-1.5 flex shrink-0 cursor-pointer items-center gap-2.5 border-t border-ds-border-muted px-2.5 py-3 text-[12.5px] text-ds-muted">
        <span className="flex-1">{t('workOutlineFloating')}</span>
        <input
          type="checkbox"
          checked={floatingOutline}
          onChange={(event) => setFloatingOutline(event.target.checked)}
          className="h-[15px] w-[15px] accent-[var(--ds-accent)]"
        />
      </label>
    </div>
  )
}
