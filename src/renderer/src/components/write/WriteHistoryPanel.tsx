import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search } from 'lucide-react'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { SidebarActivityIndicator } from '../sidebar/SidebarActivityIndicator'
import { useWriteResourceConversationHistory } from './useWriteResourceConversationHistory'
import { WriteRightPanelEmpty, WriteRightPanelHeader } from './WriteRightPanelHeader'

/**
 * Full-height conversation list for the active file or whiteboard. Picking a
 * conversation switches the thread and returns to the assistant panel.
 */
export function WriteHistoryPanel({
  busy,
  onNewConversation,
  onCollapse
}: {
  busy: boolean
  onNewConversation: () => void
  onCollapse: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const model = useWriteResourceConversationHistory(busy)
  const openPanel = useWriteWorkspaceStore((state) => state.openWriteRightPanel)
  const [query, setQuery] = useState('')
  const scopeKey = model?.scopeKey ?? null

  useEffect(() => {
    setQuery('')
    if (scopeKey) void model?.loadMissingThreads()
    // Reload only when the resource scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  const locked = !model || model.running || model.workflowLocked || !model.runtimeReady || busy
  const startNew = (): void => {
    if (!model) return
    void model.canStartConversation().then((allowed) => {
      if (!allowed) return
      onNewConversation()
      openPanel('assistant')
    })
  }
  const needle = query.trim().toLowerCase()
  const entries = (model?.entries ?? []).filter((entry) => !entry.archived)
  const visible = needle
    ? entries.filter((entry) => entry.title.toLowerCase().includes(needle))
    : entries

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WriteRightPanelHeader
        id="history"
        onCollapse={onCollapse}
        actions={model ? (
          <button
            type="button"
            onClick={startNew}
            disabled={locked}
            className="write-panel-icon-button disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('writeConversationNew')}
            title={t('writeConversationNew')}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
      />
      {!model ? (
        <WriteRightPanelEmpty>{t('workHistoryNoResource')}</WriteRightPanelEmpty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-2.5 py-3">
          <label className="mx-1 mb-2.5 flex h-[34px] shrink-0 items-center gap-2 rounded-[9px] bg-ds-hover px-2.5 text-ds-faint">
            <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('writeConversationSearch')}
              aria-label={t('writeConversationSearch')}
              className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
            />
          </label>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {visible.length === 0 ? (
              <WriteRightPanelEmpty>
                {needle ? t('writeConversationNoMatches') : t('writeConversationEmpty')}
              </WriteRightPanelEmpty>
            ) : visible.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                disabled={entry.missing || (locked && !entry.current)}
                onClick={() => {
                  if (entry.current) {
                    openPanel('assistant')
                    return
                  }
                  void model.selectConversation(entry.id).then(() => openPanel('assistant'))
                }}
                className={`write-history-item ${entry.current ? 'is-current' : ''}`}
                title={entry.missing ? t('writeConversationUnavailable') : undefined}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {entry.title || t('writeConversationFallback', { number: index + 1 })}
                  </span>
                  <SidebarActivityIndicator
                    activity={entry.activity ?? 'idle'}
                    runningLabel={t('sidebarThreadRunning')}
                    failedLabel={t('sidebarThreadFailed')}
                    unreadLabel={t('sidebarThreadUnread')}
                    awaitingInputLabel={t('sidebarThreadAwaitingInput')}
                  />
                </span>
                <span className="text-[11.5px] text-ds-faint">
                  {entry.current ? `${t('writeConversationCurrent')} · ` : ''}
                  {entry.updatedAt
                    ? formatRelativeTime(entry.updatedAt, i18n.resolvedLanguage ?? i18n.language)
                    : t('writeConversationNoTimestamp')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
