import type { ReactElement, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, PencilLine } from 'lucide-react'
import type { ComposerFileReference } from '../../lib/composer-file-references'
import { UserMessageEditField } from './UserMessageEditField'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

function Kbd({ children }: { children: string }): ReactElement {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-ds-border bg-ds-card-muted px-1 font-sans text-[10.5px] font-medium leading-none text-ds-muted">
      {children}
    </kbd>
  )
}

/**
 * Inline editor for "edit & resend": a composer-like card that replaces the
 * user bubble while editing. Focus shows on the card, never on the textarea.
 */
export function UserMessageEditCard({
  value,
  onChange,
  references,
  onReferencesChange,
  textareaRef,
  onSubmit,
  onCancel,
  submitDisabled
}: {
  value: string
  onChange: (value: string) => void
  references: ComposerFileReference[]
  onReferencesChange: (references: ComposerFileReference[]) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onSubmit: () => void
  onCancel: () => void
  submitDisabled: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      data-user-message-edit
      className="w-full max-w-[min(100%,680px)] min-w-0 rounded-[16px] border border-ds-border bg-ds-card transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ds-accent)_16%,transparent)]"
    >
      <div className="flex items-center gap-1.5 px-4 pt-3 text-[11.5px] font-medium text-ds-faint">
        <PencilLine className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        {t('rewindEditMessage')}
      </div>
      <div className="px-4 pb-1 pt-1.5">
        <UserMessageEditField
          value={value}
          onChange={onChange}
          references={references}
          onReferencesChange={onReferencesChange}
          textareaRef={textareaRef}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
        <span
          className="hidden min-w-0 flex-1 items-center gap-1 truncate pl-1 text-[11px] text-ds-faint sm:flex"
          title={t('rewindHint')}
          data-rewind-hint
        >
          <Kbd>Esc</Kbd>
          <span className="mr-2">{t('rewindCancel')}</span>
          <Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>↵</Kbd>
          <span>{t('rewindResend')}</span>
        </span>
        <span className="flex-1 sm:hidden" />
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          {t('rewindCancel')}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          data-rewind-resend
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
          {t('rewindResend')}
        </button>
      </div>
    </div>
  )
}
