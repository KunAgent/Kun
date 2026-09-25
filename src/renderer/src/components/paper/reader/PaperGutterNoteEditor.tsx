import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'

/**
 * Inline note editor used by gutter cards (visual marks now, highlight
 * comments reuse the same editor via `editingMarkId`). Enter commits,
 * Shift+Enter wraps a line, Esc cancels without saving.
 */
export function PaperGutterNoteEditor({
  initial,
  placeholder,
  onCommit,
  onDone,
  t
}: {
  initial: string
  placeholder: string
  onCommit: (value: string) => void
  onDone: () => void
  t: TFunction
}): ReactElement {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void => {
    onCommit(value.trim())
    onDone()
  }

  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        rows={2}
        className="w-full resize-none rounded-md border border-ds-border bg-ds-subtle px-2 py-1 text-[12px] leading-4 text-ds-ink outline-none placeholder:text-ds-faint focus:border-accent"
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onDone()
          }
        }}
      />
      <div className="mt-1 flex justify-end gap-1.5">
        <button
          type="button"
          className="rounded-md px-2 py-0.5 text-[11px] text-ds-muted transition hover:bg-ds-hover"
          onClick={onDone}
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          className="rounded-md bg-accent px-2 py-0.5 text-[11px] text-white transition hover:opacity-90"
          onClick={commit}
        >
          {t('writePaperReaderComment')}
        </button>
      </div>
    </div>
  )
}
