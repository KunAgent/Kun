import {
  buildMemoryMarkdownExport,
  defaultMemoryExportFileName
} from '@shared/memory-import-export'
import {
  Database,
  LayoutDashboard,
  Sparkles
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
import { MemoryCandidatesPanel } from './settings-section-memory-candidates'
import { MemoryRecordList, projectForMemory } from './settings-section-memory-list'
import {
  filterDuplicateMemoryImports,
  prepareMemoryImport,
  type MemoryScope
} from './settings-section-memory-import'

type MemorySettingsTab = 'overview' | 'records' | 'candidates'

export type MemoryDraft = {
  content: string
  scope: MemoryScope
  targetPath: string
  tags: string
  confidence: number
  type: NonNullable<CoreMemoryRecordJson['type']>
  importance: number
  directive: boolean
}

export type MemoryDialogState =
  | { mode: 'create' }
  | { mode: 'view'; memory: CoreMemoryRecordJson }
  | { mode: 'edit'; memory: CoreMemoryRecordJson }
  | { mode: 'correct'; memory: CoreMemoryRecordJson }

const EMPTY_DRAFT: MemoryDraft = {
  content: '',
  scope: 'user',
  targetPath: '',
  tags: '',
  confidence: 1,
  type: 'fact',
  importance: 0.8,
  directive: false
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
  authority: 'reference' | 'directive'
} {
  return {
    content: draft.content.trim(),
    tags: draft.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    confidence: draft.confidence,
    type: draft.type,
    importance: draft.importance,
    authority: draft.directive ? ('directive' as const) : ('reference' as const)
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
  if (dialog.mode === 'edit' || dialog.mode === 'correct') {
    const original = dialog.memory
    const originalTags = serializeMemoryTags(original.tags)
    return (
      draft.content !== original.content ||
      draft.scope !== original.scope ||
      draft.targetPath !== (projectForMemory(original) ?? '') ||
      draft.tags !== originalTags ||
      draft.confidence !== (original.confidence ?? 1) ||
      draft.type !== (original.type ?? 'fact') ||
      draft.importance !== (original.importance ?? 0.5) ||
      draft.directive !== (original.authority === 'directive')
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
    draft.importance !== EMPTY_DRAFT.importance ||
    draft.directive !== EMPTY_DRAFT.directive
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

export function MemorySettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    kun,
    updateKun,
    expandHomePath,
    memoryRecords,
    memoryCandidates,
    memoryDiagnostics,
    createMemoryRecord,
    updateMemoryRecord,
    confirmMemoryRecord,
    correctMemoryRecord,
    disableMemoryRecord,
    restoreMemoryRecord,
    deleteMemoryRecord,
    decideMemoryCandidate
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
  const [activeTab, setActiveTab] = useState<MemorySettingsTab>('overview')

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
      importance: record.importance ?? 0.5,
      directive: record.authority === 'directive'
    })
    setMemoryDialogNotice(null)
    setDialog({ mode: 'edit', memory: record })
  }

  const beginCorrection = (record: CoreMemoryRecordJson): void => {
    setDraft({
      content: record.content,
      scope: record.scope,
      targetPath: projectForMemory(record) ?? '',
      tags: (record.tags ?? []).join(', '),
      confidence: record.confidence ?? 1,
      type: record.type ?? 'fact',
      importance: record.importance ?? 0.5,
      directive: record.authority === 'directive'
    })
    setMemoryDialogNotice(null)
    setDialog({ mode: 'correct', memory: record })
  }

  const confirmMemory = async (record: CoreMemoryRecordJson): Promise<void> => {
    const confirmed = await confirmMemoryRecord(record.id)
    setMemoryDialogNotice(confirmed ? t('memoryConfirmed') : t('memoryConfirmFailed'))
  }

  const setDirective = async (record: CoreMemoryRecordJson, directive: boolean): Promise<void> => {
    const ok = await updateMemoryRecord(record.id, { authority: directive ? 'directive' : 'reference' })
    if (!ok) setNotice(t('memoryDirectiveUpdateFailed'))
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
      const downgradeMessage = preparedImport.downgradedDirectives > 0
        ? ` ${t('memoryImportDowngradedPrefix')}${preparedImport.downgradedDirectives}${t('memoryImportDowngradedSuffix')}`
        : ''
      if (failed === 0) setNotice(`${message}${skipMessage}${downgradeMessage}`)
      else setImportNotice(`${message}${skipMessage}${downgradeMessage}`)
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
    } else if (dialog?.mode === 'correct') {
      ok = await correctMemoryRecord(dialog.memory.id, mutation)
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
          { id: 'records', label: t('memoryRecords'), icon: Database },
          { id: 'candidates', label: t('memoryCandidates'), icon: Sparkles }
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
          <SettingRow
            title={t('memoryDirectivesEnable')}
            description={t('memoryDirectivesEnableDesc')}
            control={
              <Toggle
                checked={kun?.memoryDirectivesEnabled ?? true}
                disabled={!(kun?.memoryEnabled ?? false)}
                onChange={(checked: boolean) => updateKun({ memoryDirectivesEnabled: checked })}
              />
            }
          />
          <SettingRow
            title={t('memoryDistillationEnable')}
            description={t('memoryDistillationEnableDesc')}
            control={
              <Toggle
                checked={kun?.memoryDistillationEnabled ?? false}
                disabled={!(kun?.memoryEnabled ?? false)}
                onChange={(checked: boolean) => updateKun({
                  memoryDistillationEnabled: checked
                })}
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
        tabId="candidates"
        active={activeTab === 'candidates'}
      >
        <SettingsCard title={t('memoryCandidates')}>
          <SettingRow
            title={t('memoryCandidates')}
            description={t('memoryCandidatesDesc')}
            wideControl
            control={
              <MemoryCandidatesPanel
                candidates={memoryCandidates ?? []}
                decide={decideMemoryCandidate}
                t={t}
              />
            }
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
          <MemoryRecordList
            t={t}
            records={memoryRecords ?? []}
            memoryDisabled={memoryDiagnostics?.enabled === false}
            notice={notice}
            exportBusy={exportBusy}
            onImport={beginImport}
            onExport={() => void exportMemories()}
            onCreate={beginCreate}
            onView={(memory) => setDialog({ mode: 'view', memory })}
            onDisable={(id) => void disableMemoryRecord(id)}
            onRestore={(id) => void restoreMemoryRecord(id)}
            onDelete={(id) => void deleteMemoryRecord(id)}
            onSetDirective={(memory, directive) => void setDirective(memory, directive)}
          />
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
          onBeginCorrection={beginCorrection}
          onConfirm={(memory) => void confirmMemory(memory)}
          onDraftChange={setDraft}
          onSave={() => void saveDraft()}
          feedbackEnabled={memoryDiagnostics?.feedback?.enabled === true}
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
