import {
  MEMORY_IMPORT_PROFILE_PROMPT
} from '@shared/memory-import-export'
import { Clipboard, Pencil, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { CoreMemoryRecordJson } from '../agent/kun-contract'
import type { MemoryDialogState, MemoryDraft } from './settings-section-memory'

type MemoryScope = MemoryDraft['scope']
const MEMORY_TYPES: MemoryDraft['type'][] = [
  'fact',
  'preference',
  'decision',
  'episode',
  'relationship',
  'insight'
]

export function clampMemoryUnitValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function projectForMemory(memory: CoreMemoryRecordJson): string | null {
  if (memory.scope === 'user') return null
  const path = (memory.scope === 'project' ? memory.project ?? memory.workspace : memory.workspace)?.trim()
  return path || null
}

export function MemoryImportDialog({
  t,
  text,
  entries,
  portable,
  invalid,
  busy,
  notice,
  scope,
  targetPath,
  onScopeChange,
  onTargetPathChange,
  onTextChange,
  onClose,
  onImport
}: {
  t: (key: string) => string
  text: string
  entries: string[]
  portable: boolean
  invalid: boolean
  busy: boolean
  notice: string | null
  scope: MemoryScope
  targetPath: string
  onScopeChange: (scope: MemoryScope) => void
  onTargetPathChange: (value: string) => void
  onTextChange: (value: string) => void
  onClose: () => void
  onImport: () => void
}): ReactElement {
  const [copied, setCopied] = useState(false)

  const copyPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(MEMORY_IMPORT_PROFILE_PROMPT)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm dark:bg-black/55"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-ds-border bg-ds-main shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-ds-border-muted px-5 py-4">
          <div className="min-w-0 text-[18px] font-semibold text-ds-ink">{t('memoryImportTitle')}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('memoryClose')}
            title={t('memoryClose')}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-4">
            <section className="rounded-xl bg-ds-surface-subtle px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-main text-[14px] font-semibold text-ds-ink">
                    1
                  </span>
                  <div className="text-[14px] font-semibold text-ds-ink">{t('memoryImportStepPrompt')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ds-main px-3 py-2 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                >
                  <Clipboard className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {copied ? t('memoryImportCopied') : t('memoryImportCopy')}
                </button>
              </div>
              <textarea
                readOnly
                value={MEMORY_IMPORT_PROFILE_PROMPT}
                className="h-48 w-full resize-none rounded-lg border border-ds-border-muted bg-ds-main px-3 py-3 text-[13px] leading-6 text-ds-muted outline-none"
              />
            </section>

            <section className="rounded-xl bg-ds-surface-subtle px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-main text-[14px] font-semibold text-ds-ink">
                    2
                  </span>
                  <div className="text-[14px] font-semibold text-ds-ink">{t('memoryImportStepPaste')}</div>
                </div>
                <div className="text-[12px] text-ds-faint">
                  {t('memoryImportParsedPrefix')}{entries.length}{t('memoryImportParsedSuffix')}
                </div>
              </div>
              {portable ? (
                <div className="mb-3 text-[12px] text-ds-faint">{t('memoryImportPortableScopeHint')}</div>
              ) : (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <select
                    value={scope}
                    onChange={(event) => onScopeChange(event.target.value as MemoryScope)}
                    className="rounded-lg border border-ds-border-muted bg-ds-main px-2 py-1.5 text-[12px] text-ds-ink outline-none"
                  >
                    <option value="user">{t('memoryScope_user')}</option>
                    <option value="workspace">{t('memoryScope_workspace')}</option>
                    <option value="project">{t('memoryScope_project')}</option>
                  </select>
                  {scope !== 'user' ? (
                    <input
                      type="text"
                      value={targetPath}
                      onChange={(event) => onTargetPathChange(event.target.value)}
                      placeholder={t('memoryImportTargetPathPlaceholder')}
                      className="min-w-[240px] flex-1 rounded-lg border border-ds-border-muted bg-ds-main px-2 py-1.5 text-[12px] text-ds-ink outline-none focus:border-ds-ink/40"
                    />
                  ) : (
                    <div className="text-[12px] text-ds-faint">{t('memoryImportUserScopeHint')}</div>
                  )}
                </div>
              )}
              <textarea
                value={text}
                onChange={(event) => onTextChange(event.target.value)}
                placeholder={t('memoryImportPastePlaceholder')}
                className="min-h-[230px] w-full resize-y rounded-lg border border-ds-border-muted bg-ds-main px-3 py-3 text-[13px] leading-6 text-ds-ink outline-none focus:border-ds-ink/40"
              />
              {entries.length > 0 ? (
                <div className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-ds-border-muted bg-ds-main/60 px-3 py-2 text-[12px] text-ds-muted">
                  {entries.slice(0, 5).map((entry, index) => (
                    <div key={`${entry}-${index}`} className="truncate">
                      {entry}
                    </div>
                  ))}
                  {entries.length > 5 ? (
                    <div className="mt-1 text-ds-faint">{t('memoryImportMorePrefix')}{entries.length - 5}{t('memoryImportMoreSuffix')}</div>
                  ) : null}
                </div>
              ) : null}
              {notice ? (
                <div className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                  {notice}
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-ds-border-muted px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-ds-border-muted px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('memoryCancel')}
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={busy || invalid || entries.length === 0 || (!portable && scope !== 'user' && !targetPath.trim())}
            className="rounded-lg bg-ds-ink px-4 py-2 text-[13px] font-semibold text-ds-main transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? t('memoryImporting') : t('memoryImportAdd')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MemoryRecordDialog({
  dialog,
  draft,
  t,
  notice,
  onClose,
  onBeginEdit,
  onDraftChange,
  onSave
}: {
  dialog: MemoryDialogState
  draft: MemoryDraft
  t: (key: string) => string
  notice: string | null
  onClose: () => void
  onBeginEdit: (record: CoreMemoryRecordJson) => void
  onDraftChange: (draft: MemoryDraft | ((prev: MemoryDraft) => MemoryDraft)) => void
  onSave: () => void
}): ReactElement {
  const editing = dialog.mode === 'create' || dialog.mode === 'edit'
  const memory = dialog.mode === 'create' ? null : dialog.memory
  const project = memory ? projectForMemory(memory) : null
  const title = dialog.mode === 'create'
    ? t('memoryCreateTitle')
    : editing
      ? t('memoryEditTitle')
      : t('memoryDetails')

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm dark:bg-black/55"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-2xl border border-ds-border bg-ds-main shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-ds-border-muted px-4 py-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ds-ink">{title}</div>
            {memory ? (
              <div className="mt-1 flex min-w-0 flex-col gap-1 text-[11px] text-ds-faint">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-ds-hover/60 px-1.5 py-0.5 font-medium">{memory.scope}</span>
                  {memory.tags?.length ? <span>{memory.tags.join(' · ')}</span> : null}
                  <span className="font-mono opacity-60">{memory.id}</span>
                </div>
                {project ? (
                  <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-1">
                    <span className="shrink-0">{t('memoryProject')}:</span>
                    <span className="break-all" title={project}>{project}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('memoryClose')}
            title={t('memoryClose')}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {editing ? (
            <div className="flex flex-col gap-3">
              <textarea
                value={draft.content}
                onChange={(e) => onDraftChange((prev) => ({ ...prev, content: e.target.value }))}
                rows={10}
                placeholder={t('memoryContentPlaceholder')}
                className="min-h-[220px] w-full resize-y rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-ds-ink/40"
              />
              <div className="flex flex-wrap items-center gap-2">
                {dialog.mode === 'create' ? (
                  <select
                    value={draft.scope}
                    onChange={(e) => onDraftChange((prev) => ({ ...prev, scope: e.target.value as MemoryScope }))}
                    className="rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 text-[12px] text-ds-ink outline-none"
                  >
                    <option value="user">{t('memoryScope_user')}</option>
                    <option value="workspace">{t('memoryScope_workspace')}</option>
                    <option value="project">{t('memoryScope_project')}</option>
                  </select>
                ) : null}
                {dialog.mode === 'create' && draft.scope !== 'user' ? (
                  <input
                    type="text"
                    value={draft.targetPath}
                    onChange={(e) => onDraftChange((prev) => ({ ...prev, targetPath: e.target.value }))}
                    placeholder={t('memoryTargetPathPlaceholder')}
                    className="min-w-[200px] flex-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 text-[12px] text-ds-ink outline-none"
                  />
                ) : null}
                <input
                  type="text"
                  value={draft.tags}
                  onChange={(e) => onDraftChange((prev) => ({ ...prev, tags: e.target.value }))}
                  placeholder={t('memoryTagsPlaceholder')}
                  className="min-w-[160px] flex-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 text-[12px] text-ds-ink outline-none"
                />
                <div className="flex items-center gap-1 text-[12px] text-ds-faint">
                  <span>{t('memoryType')}</span>
                  <select
                    value={draft.type}
                    onChange={(e) => onDraftChange((prev) => ({
                      ...prev,
                      type: e.target.value as MemoryDraft['type']
                    }))}
                    className="rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-1.5 py-1 text-[12px] text-ds-ink outline-none"
                  >
                    {MEMORY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1 text-[12px] text-ds-faint">
                  <span>{t('memoryConfidence')}</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={draft.confidence}
                    onChange={(e) => onDraftChange((prev) => ({
                      ...prev,
                      confidence: clampMemoryUnitValue(Number(e.target.value))
                    }))}
                    className="w-14 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-1.5 py-1 text-[12px] text-ds-ink outline-none"
                  />
                </div>
                <div className="flex items-center gap-1 text-[12px] text-ds-faint">
                  <span>{t('memoryImportance')}</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={draft.importance}
                    onChange={(e) => onDraftChange((prev) => ({
                      ...prev,
                      importance: clampMemoryUnitValue(Number(e.target.value))
                    }))}
                    className="w-14 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-1.5 py-1 text-[12px] text-ds-ink outline-none"
                  />
                </div>
              </div>
              {notice ? (
                <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                  {notice}
                </div>
              ) : null}
            </div>
          ) : memory ? (
            <div className="space-y-3">
              <div className="whitespace-pre-wrap break-words rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-3 py-3 text-[13px] leading-6 text-ds-ink">
                {memory.content}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-ds-faint sm:grid-cols-4">
                <div>{t('memoryType')}: <span className="text-ds-ink">{memory.type ?? 'fact'}</span></div>
                <div>{t('memoryAuthority')}: <span className="text-ds-ink">{memory.authority ?? 'reference'}</span></div>
                <div>{t('memoryConfidence')}: <span className="font-mono text-ds-ink">{(memory.confidence ?? 1).toFixed(2)}</span></div>
                <div>{t('memoryImportance')}: <span className="font-mono text-ds-ink">{(memory.importance ?? 0.5).toFixed(2)}</span></div>
              </div>
              {memory.sources?.length ? (
                <div className="rounded-lg border border-ds-border-muted bg-ds-main/30 px-3 py-2">
                  <div className="mb-1.5 text-[11px] font-semibold text-ds-ink">{t('memorySources')}</div>
                  <div className="space-y-1 text-[11px] text-ds-faint">
                    {memory.sources.map((source) => (
                      <div key={source.id} className="break-all">
                        <span className="text-ds-ink">{source.kind}/{source.trust}</span>
                        {source.locator ? ` · ${source.locator}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-ds-border-muted px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {editing ? t('memoryCancel') : t('memoryClose')}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={onSave}
              disabled={
                !draft.content.trim() ||
                (dialog.mode === 'create' && draft.scope !== 'user' && !draft.targetPath.trim())
              }
              className="rounded-lg bg-ds-ink px-3 py-1.5 text-[12px] font-semibold text-ds-main transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t('memorySave')}
            </button>
          ) : memory ? (
            <button
              type="button"
              onClick={() => onBeginEdit(memory)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ds-ink px-3 py-1.5 text-[12px] font-semibold text-ds-main transition hover:opacity-85"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('memoryEdit')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
