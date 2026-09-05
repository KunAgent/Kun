import {
  buildMemoryMarkdownExport,
  defaultMemoryExportFileName
} from '@shared/memory-import-export'
import {
  Ban,
  BrainCircuit,
  Database,
  Download,
  Eye,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Trash2,
  Upload
} from 'lucide-react'
import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import type { CoreMemoryRecordJson } from '../agent/kun-contract'
import { confirmDialog } from '../lib/confirm-dialog'
import {
  SettingRow,
  SettingsCard,
  SettingsTabPanel,
  SettingsTabs,
  Toggle
} from './settings-controls'
import { MemoryImportDialog, MemoryRecordDialog } from './settings-section-memory-dialogs'
import { MemoryDiagnosticsPanel } from './settings-section-memory-diagnostics'
import {
  filterDuplicateMemoryImports,
  prepareMemoryImport,
  type MemoryScope
} from './settings-section-memory-import'

type MemorySettingsTab = 'overview' | 'records'

export type MemoryDraft = {
  content: string
  scope: MemoryScope
  targetPath: string
  tags: string
  confidence: number
  type: NonNullable<CoreMemoryRecordJson['type']>
  importance: number
}

export type MemoryDialogState =
  | { mode: 'create' }
  | { mode: 'view'; memory: CoreMemoryRecordJson }
  | { mode: 'edit'; memory: CoreMemoryRecordJson }

const EMPTY_DRAFT: MemoryDraft = {
  content: '',
  scope: 'user',
  targetPath: '',
  tags: '',
  confidence: 1,
  type: 'fact',
  importance: 0.8
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

export function memoryDraftMutation(draft: MemoryDraft): {
  content: string
  tags: string[]
  confidence: number
  type: MemoryDraft['type']
  importance: number
} {
  return {
    content: draft.content.trim(),
    tags: draft.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    confidence: draft.confidence,
    type: draft.type,
    importance: draft.importance
  }
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
      draft.targetPath !== (projectForMemory(original) ?? '') ||
      draft.tags !== originalTags ||
      draft.confidence !== (original.confidence ?? 1) ||
      draft.type !== (original.type ?? 'fact') ||
      draft.importance !== (original.importance ?? 0.5)
    )
  }
  // create
  return (
    draft.content.trim() !== '' ||
    draft.tags.trim() !== '' ||
    draft.targetPath.trim() !== '' ||
    draft.scope !== DEFAULT_DRAFT_SCOPE ||
    draft.confidence !== EMPTY_DRAFT.confidence ||
    draft.type !== EMPTY_DRAFT.type ||
    draft.importance !== EMPTY_DRAFT.importance
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
    expandHomePath,
    memoryRecords,
    memoryDiagnostics,
    createMemoryRecord,
    updateMemoryRecord,
    disableMemoryRecord,
    restoreMemoryRecord,
    deleteMemoryRecord
  } = ctx

  const [dialog, setDialog] = useState<MemoryDialogState | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importScope, setImportScope] = useState<MemoryScope>('user')
  const [importTargetPath, setImportTargetPath] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [memoryDialogNotice, setMemoryDialogNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY_DRAFT)
  const [scopeFilter, setScopeFilter] = useState<'all' | MemoryScope>('all')
  const [activeTab, setActiveTab] = useState<MemorySettingsTab>('overview')

  const filteredRecords = useMemo(() => {
    const records: CoreMemoryRecordJson[] = memoryRecords ?? []
    if (scopeFilter === 'all') return records
    return records.filter((record) => record.scope === scopeFilter)
  }, [memoryRecords, scopeFilter])

  const preparedImport = useMemo(
    () => prepareMemoryImport(importText, importScope, importTargetPath.trim()),
    [importScope, importTargetPath, importText]
  )
  const expandImportTargetPath = typeof expandHomePath === 'function'
    ? expandHomePath as (path: string) => string
    : (path: string) => path

  const beginCreate = (): void => {
    setDraft(EMPTY_DRAFT)
    setMemoryDialogNotice(null)
    setDialog({ mode: 'create' })
  }

  const beginImport = (): void => {
    setImportNotice(null)
    setImportScope('user')
    setImportTargetPath('')
    setImportDialogOpen(true)
  }

  const beginEdit = (record: CoreMemoryRecordJson): void => {
    setDraft({
      content: record.content,
      scope: record.scope,
      targetPath: projectForMemory(record) ?? '',
      tags: (record.tags ?? []).join(', '),
      confidence: record.confidence ?? 1,
      type: record.type ?? 'fact',
      importance: record.importance ?? 0.5
    })
    setMemoryDialogNotice(null)
    setDialog({ mode: 'edit', memory: record })
  }

  const closeDialog = (): void => {
    setDialog(null)
    setMemoryDialogNotice(null)
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

  const exportMemories = async (): Promise<void> => {
    if (typeof window.kunGui?.exportMemoryMarkdown !== 'function') {
      setNotice(t('memoryExportUnavailable'))
      return
    }
    setExportBusy(true)
    setNotice(null)
    try {
      const result = await window.kunGui.exportMemoryMarkdown({
        markdown: buildMemoryMarkdownExport({ records: memoryRecords ?? [] }),
        defaultFileName: defaultMemoryExportFileName()
      })
      if (result.ok) {
        setNotice(t('memoryExported'))
      } else if (!result.canceled) {
        setNotice(result.message)
      }
    } finally {
      setExportBusy(false)
    }
  }

  const importMemories = async (): Promise<void> => {
    if (preparedImport.kind === 'invalid-portable') {
      setImportNotice(preparedImport.error ?? t('memoryImportInvalidPortable'))
      return
    }
    if (preparedImport.candidates.length === 0) return
    const targetPath = importTargetPath.trim()
    if (preparedImport.kind === 'profile' && importScope !== 'user' && !targetPath) {
      setImportNotice(t('memoryImportTargetRequired'))
      return
    }
    setImportBusy(true)
    setNotice(null)
    setImportNotice(null)
    const selected = filterDuplicateMemoryImports({
      candidates: preparedImport.candidates,
      existingRecords: memoryRecords ?? [],
      expandPath: expandImportTargetPath
    })
    if (selected.candidates.length === 0) {
      setImportNotice(t('memoryImportAllDuplicate'))
      setImportBusy(false)
      return
    }
    let imported = 0
    try {
      for (const candidate of selected.candidates) {
        const ok = await createMemoryRecord(candidate.input)
        if (ok) imported += 1
      }
      const failed = selected.candidates.length - imported
      if (failed === 0) {
        setImportDialogOpen(false)
        setImportText('')
        setImportNotice(null)
      }
      const message = failed === 0
        ? `${t('memoryImportedPrefix')}${imported}${t('memoryImportedSuffix')}`
        : `${t('memoryImportPartialPrefix')}${imported}${t('memoryImportPartialMiddle')}${failed}${t('memoryImportPartialSuffix')}`
      const skipMessage = selected.skipped > 0
        ? ` ${t('memoryImportSkippedPrefix')}${selected.skipped}${t('memoryImportSkippedSuffix')}`
        : ''
      if (failed === 0) setNotice(`${message}${skipMessage}`)
      else setImportNotice(`${message}${skipMessage}`)
    } finally {
      setImportBusy(false)
    }
  }

  const saveDraft = async (): Promise<void> => {
    const mutation = memoryDraftMutation(draft)
    if (!mutation.content) return
    setMemoryDialogNotice(null)
    const targetPath = draft.targetPath.trim()
    if (dialog?.mode === 'create' && draft.scope !== 'user' && !targetPath) return
    let ok = false
    if (dialog?.mode === 'create') {
      ok = await createMemoryRecord({
        ...mutation,
        scope: draft.scope,
        ...(draft.scope === 'user' ? {} : { targetPath })
      })
    } else if (dialog?.mode === 'edit') {
      ok = await updateMemoryRecord(dialog.memory.id, mutation)
    }
    if (ok) closeDialog()
    else setMemoryDialogNotice(t('memorySaveFailed'))
    // On failure, keep the editor open so the user doesn't lose their draft.
    // The error is surfaced via runtimeDiagnosticsNotice in the parent handler.
  }

  return (
    <div className="space-y-5">
      <SettingsTabs<MemorySettingsTab>
        baseId="memory-settings"
        ariaLabel={t('sectionMemory')}
        items={[
          { id: 'overview', label: t('memoryOverview'), icon: LayoutDashboard },
          { id: 'records', label: t('memoryRecords'), icon: Database }
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      <SettingsTabPanel
        baseId="memory-settings"
        tabId="overview"
        active={activeTab === 'overview'}
      >
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
          <MemoryDiagnosticsPanel
            diagnostics={memoryDiagnostics}
            fallbackRecordCount={memoryRecords?.length ?? 0}
            t={t}
          />
        </SettingsCard>
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="memory-settings"
        tabId="records"
        active={activeTab === 'records'}
      >
        <SettingsCard title={t('sectionMemory')}>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
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
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={beginImport}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  <Upload className="h-3.5 w-3.5" strokeWidth={2} />
                  {t('memoryImport')}
                </button>
                <button
                  type="button"
                  onClick={() => void exportMemories()}
                  disabled={exportBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={2} />
                  {t('memoryExport')}
                </button>
                <button
                  type="button"
                  onClick={beginCreate}
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
                          onClick={() => setDialog({ mode: 'view', memory })}
                          className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          aria-label={t('memoryDetails')}
                          title={t('memoryDetails')}
                        >
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                        {memory.disabledAt ? (
                          <button
                            type="button"
                            onClick={() => void restoreMemoryRecord(memory.id)}
                            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-emerald-500/10 hover:text-emerald-600"
                            aria-label={t('memoryRestore')}
                            title={t('memoryRestore')}
                          >
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void disableMemoryRecord(memory.id)}
                            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            aria-label={t('memoryDisable')}
                            title={t('memoryDisable')}
                          >
                            <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </button>
                        )}
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
          notice={memoryDialogNotice}
          onClose={() => void requestCloseDialog()}
          onBeginEdit={beginEdit}
          onDraftChange={setDraft}
          onSave={() => void saveDraft()}
        />
      ) : null}

      {importDialogOpen ? (
        <MemoryImportDialog
          t={t}
          text={importText}
          entries={preparedImport.candidates.map((candidate) => candidate.preview)}
          portable={preparedImport.kind === 'portable'}
          invalid={preparedImport.kind === 'invalid-portable'}
          busy={importBusy}
          notice={preparedImport.kind === 'invalid-portable'
            ? t('memoryImportInvalidPortable')
            : importNotice}
          scope={importScope}
          targetPath={importTargetPath}
          onScopeChange={setImportScope}
          onTargetPathChange={setImportTargetPath}
          onTextChange={setImportText}
          onClose={() => setImportDialogOpen(false)}
          onImport={() => void importMemories()}
        />
      ) : null}
        </SettingsCard>
      </SettingsTabPanel>
    </div>
  )
}
