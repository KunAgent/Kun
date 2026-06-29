import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Ban, BrainCircuit, Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { CoreMemoryRecordJson } from '../agent/kun-contract'
import { confirmDialog } from '../lib/confirm-dialog'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'

type MemoryScope = 'user' | 'workspace' | 'project'

export type MemoryDraft = {
  content: string
  scope: MemoryScope
  targetPath: string
  tags: string
  confidence: number
}

export type MemoryDialogState =
  | { mode: 'create' }
  | { mode: 'view'; memory: CoreMemoryRecordJson }
  | { mode: 'edit'; memory: CoreMemoryRecordJson }

const EMPTY_DRAFT: MemoryDraft = {
  content: '',
  scope: 'workspace',
  targetPath: '',
  tags: '',
  confidence: 1
}

const DEFAULT_DRAFT_SCOPE: MemoryScope = EMPTY_DRAFT.scope

/**
 * Canonicalize tag input/output so equality comparisons across the edit lifecycle
 * (original record.tags array vs. user-typed string) operate on the same shape.
 */
export function serializeMemoryTags(tags: ReadonlyArray<string> | undefined | null): string {
  if (!tags || tags.length === 0) return ''
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * Returns true when the dialog's draft has user-visible unsaved changes vs. its baseline.
 * - view mode: never dirty (no draft).
 * - edit mode: dirty if content, scope, or tag string differs from the original record.
 * - create mode: dirty if any content/tags were typed or scope was changed from the default.
 */
export function isMemoryDraftDirty(
  dialog: MemoryDialogState,
  draft: MemoryDraft
): boolean {
  if (dialog.mode === 'view') return false
  if (dialog.mode === 'edit') {
    const original = dialog.memory
    const originalTags = serializeMemoryTags(original.tags)
    return (
      draft.content !== original.content ||
      draft.scope !== original.scope ||
      draft.tags !== originalTags
    )
  }
  // create
  return (
    draft.content.trim() !== '' ||
    draft.tags.trim() !== '' ||
    draft.targetPath.trim() !== '' ||
    draft.scope !== DEFAULT_DRAFT_SCOPE
  )
}

/**
 * Guard a dialog close so that pending edits aren't silently discarded.
 * Tests inject a stub `confirm` to assert the prompt-then-close lifecycle without a DOM.
 */
export async function attemptCloseMemoryDialog(args: {
  dialog: MemoryDialogState | null
  draft: MemoryDraft
  confirm: () => Promise<boolean>
  close: () => void
}): Promise<{ prompted: boolean; closed: boolean }> {
  const { dialog, draft, confirm, close } = args
  if (!dialog || !isMemoryDraftDirty(dialog, draft)) {
    close()
    return { prompted: false, closed: true }
  }
  const ok = await confirm()
  if (ok) {
    close()
    return { prompted: true, closed: true }
  }
  return { prompted: true, closed: false }
}

function projectForMemory(memory: CoreMemoryRecordJson): string | null {
  if (memory.scope === 'user') return null
  const path = (memory.scope === 'project' ? memory.project ?? memory.workspace : memory.workspace)?.trim()
  return path || null
}

function memoryPreview(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact.length <= 140) return compact
  return `${compact.slice(0, 140).trimEnd()}...`
}

export function MemorySettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    kun,
    updateKun,
    memoryRecords,
    memoryDiagnostics,
    createMemoryRecord,
    updateMemoryRecord,
    disableMemoryRecord,
    deleteMemoryRecord
  } = ctx

  const [dialog, setDialog] = useState<MemoryDialogState | null>(null)
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY_DRAFT)
  const [scopeFilter, setScopeFilter] = useState<'all' | MemoryScope>('all')

  const filteredRecords = useMemo(() => {
    const records: CoreMemoryRecordJson[] = memoryRecords ?? []
    if (scopeFilter === 'all') return records
    return records.filter((record) => record.scope === scopeFilter)
  }, [memoryRecords, scopeFilter])

  const beginCreate = (): void => {
    setDraft(EMPTY_DRAFT)
    setDialog({ mode: 'create' })
  }

  const beginEdit = (record: CoreMemoryRecordJson): void => {
    setDraft({
      content: record.content,
      scope: record.scope,
      targetPath: projectForMemory(record) ?? '',
      tags: (record.tags ?? []).join(', '),
      confidence: record.confidence ?? 1
    })
    setDialog({ mode: 'edit', memory: record })
  }

  const closeDialog = (): void => {
    setDialog(null)
    setDraft(EMPTY_DRAFT)
  }

  const requestCloseDialog = async (): Promise<void> => {
    await attemptCloseMemoryDialog({
      dialog,
      draft,
      confirm: () => confirmDialog(t('memoryDiscardConfirm'), t('memoryDiscardConfirmDetail')),
      close: closeDialog
    })
  }

  const parseTags = (raw: string): string[] =>
    raw
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)

  const saveDraft = async (): Promise<void> => {
    const trimmed = draft.content.trim()
    if (!trimmed) return
    const targetPath = draft.targetPath.trim()
    if (dialog?.mode === 'create' && draft.scope !== 'user' && !targetPath) return
    let ok = false
    if (dialog?.mode === 'create') {
      ok = await createMemoryRecord({
        content: trimmed,
        scope: draft.scope,
        ...(draft.scope === 'user' ? {} : { targetPath }),
        tags: parseTags(draft.tags),
        confidence: draft.confidence
      })
    } else if (dialog?.mode === 'edit') {
      ok = await updateMemoryRecord(dialog.memory.id, {
        content: trimmed,
        tags: parseTags(draft.tags),
        confidence: draft.confidence
      })
    }
    if (ok) closeDialog()
    // On failure, keep the editor open so the user doesn't lose their draft.
    // The error is surfaced via runtimeDiagnosticsNotice in the parent handler.
  }

  return (
    <SettingsCard title={t('sectionMemory')}>
      <SettingRow
        title={t('memoryEnable')}
        description={t('memoryEnableDesc')}
        control={
          <Toggle
            checked={kun?.memoryEnabled ?? false}
            onChange={(checked: boolean) => updateKun({ memoryEnabled: checked })}
          />
        }
      />
      <SettingRow
        title={t('memoryOverview')}
        description={t('memoryOverviewDesc')}
        wideControl
        control={
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
              <div className="text-ds-faint">{t('memoryActiveCount')}</div>
              <div className="mt-0.5 font-mono text-[15px] font-semibold text-ds-ink">
                {memoryDiagnostics?.activeCount ?? memoryRecords?.length ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
              <div className="text-ds-faint">{t('memoryTombstoneCount')}</div>
              <div className="mt-0.5 font-mono text-[15px] font-semibold text-ds-ink">
                {memoryDiagnostics?.tombstoneCount ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
              <div className="text-ds-faint">{t('memoryEnabled')}</div>
              <div className="mt-0.5 font-mono text-[15px] font-semibold text-ds-ink">
                {memoryDiagnostics?.enabled === false ? t('memoryOff') : t('memoryOn')}
              </div>
            </div>
          </div>
        }
      />

      <SettingRow
        title={t('memoryRecords')}
        description={t('memoryRecordsDesc')}
        wideControl
        control={
          <div className="flex flex-col gap-3">
            {memoryDiagnostics?.enabled === false ? (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                {t('memoryDisabledHint')}
              </div>
            ) : null}
            {/* Toolbar: scope filter + create button */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-[12px]">
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
              </div>
              <button
                type="button"
                onClick={beginCreate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ds-ink px-2.5 py-1.5 text-[12px] font-semibold text-ds-main transition hover:opacity-85"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                {t('memoryCreate')}
              </button>
            </div>

            {/* List */}
            {filteredRecords.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ds-border-muted bg-ds-main/40 px-3 py-8 text-center">
                <BrainCircuit className="h-6 w-6 text-ds-faint" strokeWidth={1.5} />
                <div className="text-[13px] text-ds-faint">{t('memoryEmpty')}</div>
              </div>
            ) : (
              filteredRecords.map((memory) => {
                const project = projectForMemory(memory)
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
                          {memory.confidence !== undefined && memory.confidence !== 1 && (
                            <span className="font-mono">★ {memory.confidence.toFixed(2)}</span>
                          )}
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
                          onClick={() => setDialog({ mode: 'view', memory })}
                          className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          aria-label={t('memoryDetails')}
                          title={t('memoryDetails')}
                        >
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(memory.disabledAt)}
                          onClick={() => void disableMemoryRecord(memory.id)}
                          className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                          aria-label={t('memoryDisable')}
                          title={t('memoryDisable')}
                        >
                          <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteMemoryRecord(memory.id)}
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
        }
      />

      {dialog ? (
        <MemoryRecordDialog
          dialog={dialog}
          draft={draft}
          t={t}
          onClose={() => void requestCloseDialog()}
          onBeginEdit={beginEdit}
          onDraftChange={setDraft}
          onSave={() => void saveDraft()}
        />
      ) : null}

      {memoryDiagnostics?.lastInjectedIds?.length ? (
        <SettingRow
          title={t('memoryLastInjected')}
          description={t('memoryLastInjectedDesc')}
          wideControl
          control={
            <div className="flex flex-wrap gap-1.5">
              {memoryDiagnostics.lastInjectedIds.map((id: string) => (
                <span
                  key={id}
                  className="rounded-lg bg-ds-hover/50 px-2 py-0.5 font-mono text-[11px] text-ds-faint"
                >
                  {id.slice(0, 12)}
                </span>
              ))}
            </div>
          }
        />
      ) : null}
    </SettingsCard>
  )
}

function MemoryRecordDialog({
  dialog,
  draft,
  t,
  onClose,
  onBeginEdit,
  onDraftChange,
  onSave
}: {
  dialog: MemoryDialogState
  draft: MemoryDraft
  t: (key: string) => string
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
                  <span>{t('memoryConfidence')}</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={draft.confidence}
                    onChange={(e) => onDraftChange((prev) => ({
                      ...prev,
                      confidence: Number(e.target.value) || 0
                    }))}
                    className="w-14 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-1.5 py-1 text-[12px] text-ds-ink outline-none"
                  />
                </div>
              </div>
            </div>
          ) : memory ? (
            <div className="whitespace-pre-wrap break-words rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-3 py-3 text-[13px] leading-6 text-ds-ink">
              {memory.content}
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
