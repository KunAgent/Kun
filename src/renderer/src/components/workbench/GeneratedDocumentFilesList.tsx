import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  Presentation,
  Sheet,
  type LucideIcon
} from 'lucide-react'
import type {
  GeneratedDocumentArtifact,
  GeneratedDocumentCollection
} from '../chat/generated-document-artifacts'

function iconFor(file: GeneratedDocumentArtifact): LucideIcon {
  if (file.kind === 'spreadsheet') return Sheet
  if (file.kind === 'presentation' || file.kind === 'kun-html') return Presentation
  return FileText
}

function labelKeyFor(file: GeneratedDocumentArtifact): string {
  if (file.kind === 'word') return 'generatedDocumentKindWord'
  if (file.kind === 'spreadsheet') return 'generatedDocumentKindSpreadsheet'
  if (file.kind === 'pdf') return 'generatedDocumentKindPdf'
  if (file.kind === 'kun-html') return 'generatedDocumentKindKunPpt'
  return 'generatedDocumentKindPresentation'
}

export function GeneratedDocumentFilesList({
  collection,
  selectedPath,
  onPreview,
  onBackToWorkspace
}: {
  collection: GeneratedDocumentCollection
  selectedPath?: string | null
  onPreview: (file: GeneratedDocumentArtifact) => void
  onBackToWorkspace: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full min-h-0 flex-col" data-generated-document-list>
      <header className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted/70 px-3 py-2.5">
        <button
          type="button"
          onClick={onBackToWorkspace}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('generatedDocumentBackToWorkspace')}
          title={t('generatedDocumentBackToWorkspace')}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-ds-card-muted text-ds-muted">
          <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ds-ink">
            {t('generatedDocumentAllFiles', { count: collection.files.length })}
          </span>
          <span className="block truncate text-[11px] text-ds-faint">
            {t('generatedDocumentTurnFilesHint')}
          </span>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {collection.files.map((file) => {
            const Icon = iconFor(file)
            const active = selectedPath === file.path
            return (
              <button
                key={file.path}
                type="button"
                data-generated-document-list-item={file.path}
                onClick={() => onPreview(file)}
                className={`flex w-full min-w-0 items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition ${
                  active ? 'bg-accent-soft text-ds-ink' : 'hover:bg-ds-hover'
                }`}
                title={file.path}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-ds-border-muted bg-ds-card text-ds-muted">
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ds-ink">
                    {file.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-ds-faint">
                    {[t(labelKeyFor(file)), file.extension].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] font-medium text-ds-muted">
                  {t('generatedDocumentPreview')}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
