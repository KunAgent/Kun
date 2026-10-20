import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { Check, Info, Loader2, Sparkles, Undo2, X } from 'lucide-react'
import { ComposerInlineError } from './ComposerInlineError'
import type { PromptEnhanceNotice } from './composer-prompt-enhance-state'
import type { ComposerPromptEnhance } from './use-composer-prompt-enhance'

function unsupportedText(t: TFunction, agentLabel: string | undefined): string {
  return agentLabel
    ? t('composerPromptEnhanceUnsupportedAgent', { agent: agentLabel })
    : t('composerPromptEnhanceUnsupported')
}

function errorText(t: TFunction, notice: Extract<PromptEnhanceNotice, { kind: 'error' }>): string {
  if (notice.code === 'timeout') return t('composerPromptEnhanceTimeout')
  if (notice.code === 'disabled') return t('composerPromptEnhanceDisabled')
  return t('composerPromptEnhanceFailed', { message: notice.message })
}

export function ComposerPromptEnhanceButton({ enhance, t }: { enhance: ComposerPromptEnhance; t: TFunction }): ReactElement {
  const unavailable = !enhance.running && enhance.target.kind === 'unsupported'
  const label = enhance.running
    ? t('composerPromptEnhanceCancel')
    : t('composerPromptEnhance')
  const title = enhance.running
    ? t('composerPromptEnhanceCancelHint')
    : enhance.target.kind === 'unsupported'
      ? unsupportedText(t, enhance.target.agentLabel)
      : enhance.target.label
        ? t('composerPromptEnhanceHint', { model: enhance.target.label })
        : t('composerPromptEnhanceHintDefault')
  return (
    <button
      type="button"
      disabled={!enhance.editable && !enhance.running}
      onClick={enhance.onClick}
      aria-label={label}
      aria-disabled={unavailable || undefined}
      title={title}
      data-prompt-enhance-state={enhance.running ? 'running' : unavailable ? 'unavailable' : 'idle'}
      className={`ds-composer-optional-action ds-composer-prompt-optimize-action ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60 ${
        enhance.running ? 'bg-ds-hover text-ds-ink' : unavailable ? 'text-ds-faint opacity-60' : 'text-ds-muted hover:text-ds-ink'
      }`}
    >
      {enhance.running ? (
        <span className="relative flex h-6 w-6 items-center justify-center" aria-hidden>
          <svg className="absolute inset-0 h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--ds-accent)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="h-2 w-2 rounded-[2px] bg-current" />
        </span>
      ) : (
        <Sparkles className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  )
}

const ROW_CLASS = 'mx-1 flex items-start gap-2 rounded-[10px] bg-ds-subtle px-2.5 py-1.5 text-[12px] leading-[1.45] text-ds-muted'
const ROW_ICON_CLASS = 'mt-[2px] h-3.5 w-3.5 shrink-0'

function DismissButton({ onClick, label }: { onClick: () => void; label: string }): ReactElement {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="ds-no-drag -mr-1 shrink-0 rounded-md p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink">
      <X className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )
}

/** One status row between the draft and the toolbar: running, a notice, or the undo offer. */
export function ComposerPromptEnhanceStatus({ enhance, t, onOpenSettings }: {
  enhance: ComposerPromptEnhance
  t: TFunction
  onOpenSettings?: () => void
}): ReactElement | null {
  const { state } = enhance
  if (state.running) {
    return (
      <div className={ROW_CLASS} role="status" aria-live="polite" data-prompt-enhance-status="running">
        <Loader2 className={`${ROW_ICON_CLASS} animate-spin text-ds-ink`} strokeWidth={2.2} aria-hidden />
        <span className="min-w-0 flex-1">
          {state.running.label
            ? t('composerPromptEnhanceRunning', { model: state.running.label })
            : t('composerPromptEnhanceRunningDefault')}
        </span>
      </div>
    )
  }
  if (state.notice?.kind === 'error') {
    return <ComposerInlineError message={errorText(t, state.notice)} onDismiss={enhance.onDismiss} dismissLabel={t('composerDismissError')} />
  }
  if (state.notice) {
    const unsupported = state.notice.kind === 'unsupported'
    return (
      <div className={ROW_CLASS} role="status" aria-live="polite" data-prompt-enhance-status={state.notice.kind}>
        <Info className={ROW_ICON_CLASS} strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1">
          {unsupported ? unsupportedText(t, state.notice.kind === 'unsupported' ? state.notice.agentLabel : undefined) : t('composerPromptEnhanceEmpty')}
        </span>
        {unsupported && onOpenSettings ? (
          <button type="button" onClick={onOpenSettings}
            className="ds-no-drag shrink-0 rounded-md px-1 font-semibold text-ds-ink underline-offset-2 hover:underline">
            {t('composerPromptEnhanceOpenSettings')}
          </button>
        ) : null}
        {unsupported ? <DismissButton onClick={enhance.onDismiss} label={t('composerPromptEnhanceDismiss')} /> : null}
      </div>
    )
  }
  if (state.undo) {
    const shortcut = window.kunGui?.platform === 'darwin' ? '⌘Z' : 'Ctrl+Z'
    return (
      <div className={`${ROW_CLASS} items-center`} role="status" data-prompt-enhance-status="done">
        <Check className="h-3.5 w-3.5 shrink-0 text-ds-status-success" strokeWidth={2.4} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('composerPromptEnhanceDone', { model: state.undo.label })}</span>
        <button type="button" onClick={enhance.onUndo} title={t('composerPromptEnhanceUndoHint')}
          className="ds-no-drag flex h-6 shrink-0 items-center gap-1 rounded-md border border-ds-border bg-ds-card px-2 text-ds-ink transition hover:bg-ds-hover">
          <Undo2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {t('composerPromptEnhanceUndo')}
          <span className="text-ds-faint">{shortcut}</span>
        </button>
        <DismissButton onClick={enhance.onDismiss} label={t('composerPromptEnhanceDismiss')} />
      </div>
    )
  }
  return null
}
