import type { ReactElement } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread } from '../../agent/types'
import {
  formatExportRowTime,
  groupExportThreads,
  workspaceLabel,
  type ExportScope
} from './conversation-export-model'

const GROUP_KEYS = {
  today: 'exportDialogGroupToday',
  yesterday: 'exportDialogGroupYesterday',
  week: 'exportDialogGroupWeek',
  earlier: 'exportDialogGroupEarlier'
} as const
const SCOPES: ExportScope[] = ['all', 'workspace', 'week']
const SCOPE_KEYS: Record<ExportScope, string> = {
  all: 'exportDialogScopeAll',
  workspace: 'exportDialogScopeWorkspace',
  week: 'exportDialogScopeWeek'
}

type Props = {
  threads: NormalizedThread[]
  selected: ReadonlySet<string>
  activeThreadId: string | null
  query: string
  scope: ExportScope
  includeArchived: boolean
  disabled: boolean
  now: number
  onQuery: (value: string) => void
  onScope: (value: ExportScope) => void
  onIncludeArchived: (value: boolean) => void
  onToggle: (id: string) => void
  onToggleAll: (checked: boolean) => void
  onClear: () => void
}

export function ConversationExportList(props: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const { threads, selected, disabled } = props
  const groups = groupExportThreads(threads, props.now)
  const allChecked = threads.length > 0 && threads.every((thread) => selected.has(thread.id))

  return (
    <div className="flex min-h-0 w-[384px] shrink-0 flex-col border-r border-ds-border bg-ds-subtle/40">
      <div className="flex flex-col gap-2.5 px-4 pb-2.5 pt-3.5">
        <label className="flex h-[34px] items-center gap-2 rounded-[10px] border border-ds-border bg-ds-card px-2.5 text-ds-faint focus-within:border-accent">
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={props.query}
            disabled={disabled}
            onChange={(event) => props.onQuery(event.target.value)}
            placeholder={t('exportDialogSearch')}
            aria-label={t('exportDialogSearchLabel')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              aria-pressed={props.scope === scope}
              disabled={disabled}
              onClick={() => props.onScope(scope)}
              className={`h-[26px] rounded-full border px-2.5 text-xs transition ${
                props.scope === scope
                  ? 'border-transparent bg-ds-ink text-ds-card'
                  : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover'
              }`}
            >
              {t(SCOPE_KEYS[scope])}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ds-muted">
            <input
              type="checkbox"
              checked={props.includeArchived}
              disabled={disabled}
              onChange={(event) => props.onIncludeArchived(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--ds-accent,#5b78ff)]"
            />
            {t('exportDialogIncludeArchived')}
          </label>
        </div>
      </div>

      <div className="flex h-[34px] shrink-0 items-center gap-2.5 border-y border-ds-border px-4 text-[12.5px] text-ds-muted">
        <input
          type="checkbox"
          checked={allChecked}
          disabled={disabled || threads.length === 0}
          onChange={(event) => props.onToggleAll(event.target.checked)}
          aria-label={t('exportDialogSelectAllLabel')}
          className="h-4 w-4 accent-[var(--ds-accent,#5b78ff)]"
        />
        <span>{t('exportDialogSelectAll')}</span>
        <span className="text-ds-faint">{t('exportDialogListCount', { count: threads.length })}</span>
        {selected.size > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={props.onClear}
            className="ml-auto text-accent hover:underline disabled:opacity-50"
          >
            {t('exportDialogClearSelection')}
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2.5 pt-1">
        {groups.map((group) => (
          <section key={group.id} aria-label={t(GROUP_KEYS[group.id])}>
            <h3 className="px-2.5 pb-1 pt-2.5 text-[11.5px] font-semibold text-ds-faint">
              {t(GROUP_KEYS[group.id])}
            </h3>
            {group.threads.map((thread) => {
              const checked = selected.has(thread.id)
              const project = workspaceLabel(thread.workspace) || t('exportDialogNoProject')
              const running = thread.status === 'running' || thread.latestTurnStatus === 'running'
              return (
                <label
                  key={thread.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 transition ${
                    checked ? 'bg-accent-soft' : 'hover:bg-ds-hover'
                  } ${disabled ? 'pointer-events-none opacity-70' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => props.onToggle(thread.id)}
                    aria-label={thread.title}
                    className="h-4 w-4 shrink-0 accent-[var(--ds-accent,#5b78ff)]"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-medium text-ds-ink">{thread.title}</span>
                      {thread.id === props.activeThreadId ? (
                        <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold leading-[18px] text-accent">
                          {t('exportDialogCurrent')}
                        </span>
                      ) : null}
                      {running ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ds-subtle px-1.5 text-[11px] font-semibold leading-[18px] text-ds-status-warning">
                          <span className="h-[5px] w-[5px] rounded-full bg-current" aria-hidden="true" />
                          {t('exportDialogRunning')}
                        </span>
                      ) : null}
                      {thread.archived ? (
                        <span className="shrink-0 rounded-full bg-ds-subtle px-1.5 text-[11px] leading-[18px] text-ds-muted">
                          {t('exportDialogArchived')}
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-ds-muted">{project}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ds-faint">
                    {formatExportRowTime(thread.updatedAt, i18n.language, props.now)}
                  </span>
                </label>
              )
            })}
          </section>
        ))}
        {threads.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ds-faint">{t('exportDialogNoMatch')}</p>
        ) : null}
      </div>
    </div>
  )
}
