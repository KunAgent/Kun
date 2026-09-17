import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeWorkWhiteboardTitle } from '../../write/work-whiteboard'
import { DEFAULT_CANVAS_ENGINE, type CanvasEngine } from '../../whiteboard/canvas-engine'
import { CanvasEngineSwitcher } from '../../whiteboard/excalidraw-surface'

export const WORK_WHITEBOARD_TITLE_MAX_LENGTH = 160

export type WorkWhiteboardTitleDialogProps = {
  submitting?: boolean
  onSubmit: (title: string, engine: CanvasEngine) => void
  onClose: () => void
}

/**
 * Title-first creation dialog shared by every manual "new whiteboard" entry.
 * Owns only input/validation; the caller persists the board after submit.
 */
export function WorkWhiteboardTitleDialog({
  submitting = false,
  onSubmit,
  onClose
}: WorkWhiteboardTitleDialogProps): ReactElement {
  const { t } = useTranslation('common')
  const [value, setValue] = useState('')
  const [engine, setEngine] = useState<CanvasEngine>(DEFAULT_CANVAS_ENGINE)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const trimmed = value.trim()
  const empty = trimmed.length === 0
  const tooLong = trimmed.length > WORK_WHITEBOARD_TITLE_MAX_LENGTH

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (submitting || empty || tooLong) return
    onSubmit(normalizeWorkWhiteboardTitle(value), engine)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (!submitting) onClose()
    }
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={submitting ? undefined : onClose}
      data-work-whiteboard-title-dialog="true"
    >
      <form
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <h2 className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
          {t('writeCreateWhiteboard')}
        </h2>
        <input
          ref={inputRef}
          value={value}
          maxLength={WORK_WHITEBOARD_TITLE_MAX_LENGTH * 2}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('writeNewWhiteboardTitlePlaceholder')}
          aria-label={t('writeCreateWhiteboard')}
          data-work-whiteboard-title-input="true"
          className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
          title={tooLong ? t('writeWhiteboardTitleTooLong', {
            max: WORK_WHITEBOARD_TITLE_MAX_LENGTH,
            defaultValue: `Title must be at most ${WORK_WHITEBOARD_TITLE_MAX_LENGTH} characters.`
          }) : undefined}
        />
        <div className="mt-3">
          <CanvasEngineSwitcher
            engine={engine}
            canSwitch
            onChange={setEngine}
            kunLabel={t('canvasEngineKun')}
            excalidrawLabel={t('canvasEngineExcalidraw')}
          />
          <p className="mt-2 text-[11px] leading-4 text-ds-faint">{t('canvasEngineSwitchHint')}</p>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            data-work-whiteboard-title-cancel="true"
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          >
            {t('writeEntryDialogCancel')}
          </button>
          <button
            type="submit"
            disabled={submitting || empty || tooLong}
            data-work-whiteboard-title-submit="true"
            className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t('writeEntryDialogCreate')}
          </button>
        </div>
      </form>
    </div>
  )
}
