import {
  Ban,
  BrainCircuit,
  Download,
  Eye,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
  Upload
} from 'lucide-react'
import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import type { CoreMemoryRecordJson } from '../agent/kun-contract'

export type MemoryAuthorityFilter = 'all' | 'directive' | 'reference'

type MemoryScopeFilter = 'all' | NonNullable<CoreMemoryRecordJson['scope']>

/** Directives are injected as user-level instructions every turn, so keep them short. */
export const MEMORY_DIRECTIVE_MAX_CONTENT_CHARS = 1_000

export function projectForMemory(memory: CoreMemoryRecordJson): string | null {
  if (memory.scope === 'user') return null
  const path = (memory.scope === 'project' ? memory.project ?? memory.workspace : memory.workspace)?.trim()
  return path || null
}

function memoryPreview(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact.length <= 140) return compact
  return `${compact.slice(0, 140).trimEnd()}...`
}

export function MemoryRecordList({
  t,
  records,
  memoryDisabled,
  notice,
  exportBusy,
  onImport,
  onExport,
  onCreate,
  onView,
  onDisable,
  onRestore,
  onDelete,
  onSetDirective
}: {
  t: (key: string) => string
  records: CoreMemoryRecordJson[]
  memoryDisabled?: boolean
  notice: string | null
  exportBusy: boolean
  onImport: () => void
  onExport: () => void
  onCreate: () => void
  onView: (memory: CoreMemoryRecordJson) => void
  onDisable: (memoryId: string) => void
  onRestore: (memoryId: string) => void
  onDelete: (memoryId: string) => void
  onSetDirective: (memory: CoreMemoryRecordJson, directive: boolean) => void
}): ReactElement {
  const [scopeFilter, setScopeFilter] = useState<MemoryScopeFilter>('all')
  const [authorityFilter, setAuthorityFilter] = useState<MemoryAuthorityFilter>('all')

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (scopeFilter !== 'all' && record.scope !== scopeFilter) return false
      if (authorityFilter !== 'all' && (record.authority ?? 'reference') !== authorityFilter) return false
      return true
    })
  }, [records, scopeFilter, authorityFilter])

  return (
    <div className="flex flex-col gap-3">
      {memoryDisabled ? (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
          {t('memoryDisabledHint')}
        </div>
      ) : null}
      {/* Toolbar: filters + create button */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 text-[12px]">
          {(['all', 'user', 'workspace', 'project'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setScopeFilter(scope)}
              className={`rounded-lg px-2 py-1 font-medium transition ${
                scopeFilter === scope
                  ? 'bg-ds-ink text-ds-main'
                  : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              {t(`memoryScope_${scope}`)}
            </button>
          ))}
          <span className="mx-1 h-3.5 w-px bg-ds-border-muted" />
          {(['all', 'directive', 'reference'] as const).map((authority) => (
            <button
              key={authority}
              type="button"
              onClick={() => setAuthorityFilter(authority)}
              className={`rounded-lg px-2 py-1 font-medium transition ${
                authorityFilter === authority
                  ? 'bg-ds-ink text-ds-main'
                  : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              {t(`memoryAuthority_${authority}`)}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            {t('memoryImport')}
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={exportBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            {t('memoryExport')}
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ds-ink px-2.5 py-1.5 text-[12px] font-semibold text-ds-main transition hover:opacity-85"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {t('memoryCreate')}
          </button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2 text-[12px] text-ds-muted">
          {notice}
        </div>
      ) : null}

      {/* List */}
      {filteredRecords.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ds-border-muted bg-ds-main/40 px-3 py-8 text-center">
          <BrainCircuit className="h-6 w-6 text-ds-faint" strokeWidth={1.5} />
          <div className="text-[13px] text-ds-faint">{t('memoryEmpty')}</div>
        </div>
      ) : (
        filteredRecords.map((memory) => {
          const project = projectForMemory(memory)
          const isDirective = memory.authority === 'directive'
          const canPromote =
            !isDirective &&
            memory.scope !== 'project' &&
            memory.content.trim().length <= MEMORY_DIRECTIVE_MAX_CONTENT_CHARS
          return (
            <div
              key={memory.id}
              className={`rounded-xl border px-3 py-2 transition ${
                memory.disabledAt
                  ? 'border-ds-border-muted bg-ds-main/20 opacity-60'
                  : 'border-ds-border-muted bg-ds-main/40'
              }`}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ds-ink" title={memory.content}>
                    {memoryPreview(memory.content)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ds-faint">
                    <span className="rounded bg-ds-hover/60 px-1.5 py-0.5 font-medium">{memory.scope}</span>
                    {isDirective ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                        {t('memoryAuthority_directive')}
                      </span>
                    ) : null}
                    {memory.confidence !== undefined && memory.confidence !== 1 && (
                      <span className="font-mono">★ {memory.confidence.toFixed(2)}</span>
                    )}
                    {memory.type ? <span>{memory.type}</span> : null}
                    {memory.importance !== undefined ? <span className="font-mono">I {memory.importance.toFixed(2)}</span> : null}
                    {memory.tags?.length ? (
                      <span>{memory.tags.join(' · ')}</span>
                    ) : null}
                    {project ? (
                      <span className="flex min-w-0 max-w-full items-baseline gap-1">
                        <span>{t('memoryProject')}:</span>
                        <span className="break-all font-mono" title={project}>
                          {project}
                        </span>
                      </span>
                    ) : null}
                    {memory.disabledAt ? <span className="text-amber-600">{t('memoryDisabled')}</span> : null}
                    <span className="font-mono opacity-60">{memory.id.slice(0, 8)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onView(memory)}
                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    aria-label={t('memoryDetails')}
                    title={t('memoryDetails')}
                  >
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                  {isDirective ? (
                    <button
                      type="button"
                      onClick={() => onSetDirective(memory, false)}
                      className="rounded-lg p-1.5 text-emerald-600 transition hover:bg-ds-hover hover:text-ds-ink dark:text-emerald-400"
                      aria-label={t('memoryUnsetDirective')}
                      title={t('memoryUnsetDirective')}
                    >
                      <PinOff className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSetDirective(memory, true)}
                      disabled={!canPromote}
                      className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t('memorySetDirective')}
                      title={
                        canPromote
                          ? t('memorySetDirective')
                          : t('memorySetDirectiveDisabled')
                      }
                    >
                      <Pin className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  )}
                  {memory.disabledAt ? (
                    <button
                      type="button"
                      onClick={() => onRestore(memory.id)}
                      className="rounded-lg p-1.5 text-ds-muted transition hover:bg-emerald-500/10 hover:text-emerald-600"
                      aria-label={t('memoryRestore')}
                      title={t('memoryRestore')}
                    >
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDisable(memory.id)}
                      className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('memoryDisable')}
                      title={t('memoryDisable')}
                    >
                      <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(memory.id)}
                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                    aria-label={t('memoryDelete')}
                    title={t('memoryDelete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
