import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { ConversationExportFormat } from '@shared/conversation-export'
import type { ConversationExportInclude } from '../../lib/conversation-export'
import type { ExportLayout } from './conversation-export-model'
import { exportFileName } from './conversation-export-model'

const PARTS: Array<{ key: keyof ConversationExportInclude; label: string; hint: string; isNew?: boolean }> = [
  { key: 'attachments', label: 'exportDialogPartAttachments', hint: 'exportDialogPartAttachmentsHint' },
  { key: 'sources', label: 'exportDialogPartSources', hint: 'exportDialogPartSourcesHint' },
  { key: 'generated', label: 'exportDialogPartGenerated', hint: 'exportDialogPartGeneratedHint' },
  { key: 'toolCalls', label: 'exportDialogPartToolCalls', hint: 'exportDialogPartToolCallsHint', isNew: true },
  { key: 'reasoning', label: 'exportDialogPartReasoning', hint: 'exportDialogPartReasoningHint', isNew: true }
]

type Props = {
  format: ConversationExportFormat
  layout: ExportLayout
  include: ConversationExportInclude
  selectedTitles: string[]
  disabled: boolean
  onFormat: (value: ConversationExportFormat) => void
  onLayout: (value: ExportLayout) => void
  onInclude: (key: keyof ConversationExportInclude, value: boolean) => void
}

function previewLines(props: Props, folder: string, merged: string): Array<{ text: string; depth: number; muted?: boolean }> {
  const { selectedTitles: titles, format } = props
  if (titles.length === 0) return []
  if (titles.length === 1) return [{ text: exportFileName(titles[0]!, format), depth: 0 }]
  if (props.layout === 'merge') {
    return [{ text: `${merged}.${format}`, depth: 0 }, ...titles.slice(0, 4).map((title, index) => ({
      text: `${index + 1}. ${title}`, depth: 1, muted: true
    }))]
  }
  const lines = [{ text: `${folder}/`, depth: 0 }, ...titles.slice(0, 4).map((title) => ({
    text: exportFileName(title, format), depth: 1
  }))]
  return titles.length > 4 ? [...lines, { text: `… +${titles.length - 4}`, depth: 1, muted: true }] : lines
}

export function ConversationExportOptions(props: Props & { folderName: string; mergedName: string }): ReactElement {
  const { t } = useTranslation('common')
  const lines = previewLines(props, props.folderName, props.mergedName)
  const formats: Array<{ id: ConversationExportFormat; badge: string; label: string; hint: string }> = [
    { id: 'md', badge: 'MD', label: 'Markdown', hint: t('exportDialogFormatMdHint') },
    { id: 'pdf', badge: 'PDF', label: 'PDF', hint: t('exportDialogFormatPdfHint') }
  ]
  const layouts: Array<{ id: ExportLayout; label: string }> = [
    { id: 'files', label: t('exportDialogLayoutFiles') },
    { id: 'merge', label: t('exportDialogLayoutMerge') }
  ]
  const heading = 'text-xs font-semibold text-ds-muted'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-[18px]">
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className={`${heading} mb-2 p-0`}>{t('exportDialogFormat')}</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {formats.map((format) => (
            <button
              key={format.id}
              type="button"
              aria-pressed={props.format === format.id}
              disabled={props.disabled}
              onClick={() => props.onFormat(format.id)}
              className={`flex items-center gap-3 rounded-xl border-[1.5px] p-3 text-left transition ${
                props.format === format.id ? 'border-accent bg-accent-soft' : 'border-ds-border bg-ds-card hover:bg-ds-hover'
              }`}
            >
              <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-ds-subtle text-[11px] font-bold text-ds-muted">
                {format.badge}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-[13.5px] font-semibold text-ds-ink">{format.label}</strong>
                <span className="text-xs text-ds-muted">{format.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {props.selectedTitles.length > 1 ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className={`${heading} mb-2 p-0`}>{t('exportDialogLayout')}</legend>
          <div className="flex rounded-[10px] bg-ds-subtle p-[3px]">
            {layouts.map((layout) => (
              <button
                key={layout.id}
                type="button"
                aria-pressed={props.layout === layout.id}
                disabled={props.disabled}
                onClick={() => props.onLayout(layout.id)}
                className={`h-[30px] flex-1 rounded-lg text-[12.5px] transition ${
                  props.layout === layout.id
                    ? 'bg-ds-card font-semibold text-ds-ink shadow-sm'
                    : 'text-ds-muted hover:text-ds-ink'
                }`}
              >
                {layout.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
        <legend className={`${heading} mb-2 p-0`}>{t('exportDialogContent')}</legend>
        <div className="flex min-h-[30px] items-center gap-2.5 text-[13px] text-ds-muted">
          <Check className="h-4 w-4 text-accent" strokeWidth={2.2} aria-hidden="true" />
          {t('exportDialogPartMessages')}
          <span className="text-xs text-ds-faint">{t('exportDialogAlways')}</span>
        </div>
        {PARTS.map((part) => (
          <label key={part.key} className="flex min-h-[30px] cursor-pointer items-center gap-2.5 text-[13px] text-ds-ink">
            <input
              type="checkbox"
              checked={props.include[part.key]}
              disabled={props.disabled}
              onChange={(event) => props.onInclude(part.key, event.target.checked)}
              className="h-4 w-4 accent-[var(--ds-accent,#5b78ff)]"
            />
            <span>{t(part.label)}</span>
            {part.isNew ? (
              <span className="rounded-full bg-accent-soft px-1.5 text-[10.5px] font-semibold leading-[17px] text-accent">
                {t('exportDialogNew')}
              </span>
            ) : null}
            <span className="text-xs text-ds-faint">{t(part.hint)}</span>
          </label>
        ))}
      </fieldset>

      <section className="flex min-w-0 flex-col gap-2" aria-label={t('exportDialogPreview')}>
        <h3 className={`${heading} m-0`}>{t('exportDialogPreview')}</h3>
        <div className="flex flex-col gap-0.5 rounded-xl border border-ds-border bg-ds-subtle/40 px-3 py-2.5 font-mono text-xs leading-5">
          {lines.length === 0 ? (
            <span className="text-ds-faint">{t('exportDialogPreviewNone')}</span>
          ) : lines.map((line, index) => (
            <span
              key={`${line.text}-${index}`}
              className={`truncate ${line.muted ? 'text-ds-faint' : 'text-ds-ink'}`}
              style={{ paddingLeft: line.depth * 16 }}
            >
              {line.text}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
