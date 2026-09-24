import { useState, type FormEvent, type ReactElement } from 'react'
import { FileUp, GraduationCap, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaperStore } from '../../../write/paper/paper-store'

const IMPORT_STAGES = ['metadata', 'pdf', 'text', 'figures'] as const

/**
 * Paper import dialog (§6.1): accepts an arXiv id/URL, a papers.cool URL, or a
 * local PDF picked via `pickLocalFiles`. While an import runs, the stage list
 * lights up from `paper:progress` events and the submit button becomes a
 * cancel button.
 */
export function WritePaperImportDialog({
  onImport,
  onImportPdf,
  onCancel,
  onClose
}: {
  onImport: (input: string) => Promise<boolean>
  onImportPdf: (localPdfPath: string) => Promise<boolean>
  onCancel: () => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [value, setValue] = useState('')
  const job = usePaperStore((s) => s.busy.import)
  const notice = usePaperStore((s) => s.notice)
  const running = job?.status === 'running'

  const pickPdf = async (): Promise<void> => {
    if (running || typeof window.kunGui?.pickLocalFiles !== 'function') return
    const picked = await window.kunGui.pickLocalFiles()
    if (picked.canceled) return
    const pdf = picked.paths.find((path) => /\.pdf$/i.test(path))
    if (!pdf) {
      usePaperStore.getState().setNotice({ tone: 'error', message: t('writePaperPickPdfOnly') })
      return
    }
    if (await onImportPdf(pdf)) onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (running) return
    const input = value.trim()
    if (!input) return
    if (await onImport(input)) onClose()
  }

  const stageIndex = job ? IMPORT_STAGES.indexOf(job.stage as (typeof IMPORT_STAGES)[number]) : -1

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={() => { if (!running) onClose() }}
    >
      <form
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <GraduationCap className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <h2 className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
            {t('writePaperImportTitle')}
          </h2>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {t('writePaperImportDesc')}
        </p>

        <input
          autoFocus
          value={value}
          disabled={running}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('writePaperImportPlaceholder')}
          spellCheck={false}
          className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 font-mono text-[13px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:opacity-60"
        />

        <button
          type="button"
          disabled={running}
          onClick={() => void pickPdf()}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg text-[12.5px] font-medium text-ds-muted transition hover:text-accent disabled:opacity-60"
        >
          <FileUp className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('writePaperImportLocalPdf')}
        </button>

        {job ? (
          <div className="mt-4 space-y-1.5" aria-live="polite">
            {IMPORT_STAGES.map((stage, index) => {
              const state = !running && job.status === 'done'
                ? 'done'
                : index < stageIndex
                  ? 'done'
                  : index === stageIndex && running
                    ? 'active'
                    : 'pending'
              return (
                <div key={stage} className="flex items-center gap-2 text-[12.5px]">
                  {state === 'active' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2} />
                  ) : (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        state === 'done' ? 'bg-emerald-500' : 'bg-ds-faint/40'
                      }`}
                    />
                  )}
                  <span className={state === 'pending' ? 'text-ds-faint' : 'text-ds-ink'}>
                    {t(`writePaperStage_${stage}`)}
                  </span>
                  {state === 'active' && job.message ? (
                    <span className="min-w-0 flex-1 truncate text-ds-faint">{job.message}</span>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}

        {notice ? (
          <p
            className={`mt-3 rounded-xl border px-3 py-2 text-[12.5px] leading-5 ${
              notice.tone === 'error'
                ? 'border-red-200/70 bg-red-50/80 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
                : 'border-ds-border-muted bg-ds-subtle/60 text-ds-muted'
            }`}
          >
            {notice.message}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              {t('writePaperCancel')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('writeEntryDialogCancel')}
              </button>
              <button
                type="submit"
                disabled={!value.trim()}
                className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {t('writePaperImportSubmit')}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
