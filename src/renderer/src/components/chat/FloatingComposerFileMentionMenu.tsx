import { useEffect, useRef, type ReactElement } from 'react'
import { BookOpen, FileText, Folder, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  formatComposerFileMentionToken,
  formatComposerKnowledgeBaseMentionToken,
  isComposerDirectoryReference
} from '../../lib/composer-file-references'
import { syncComposerMenuScroll } from './composer-menu-scroll'
import {
  composerMentionSuggestionKey,
  type ComposerMentionSuggestion
} from './use-composer-file-mentions'

type Props = {
  suggestions: ComposerMentionSuggestion[]
  loading: boolean
  selectedIndex: number
  highlighted: ComposerMentionSuggestion | null
  hasMountedKnowledgeBases: boolean
  /** Code projects mount knowledge bases below the composer; Work has no such entry. */
  knowledgeBaseHint?: boolean
  onSelect: (suggestion: ComposerMentionSuggestion) => void
}

/** Focused, keyboard-synchronized view for workspace file-mention suggestions. */
export function FloatingComposerFileMentionMenu({
  suggestions,
  loading,
  selectedIndex,
  highlighted,
  hasMountedKnowledgeBases,
  knowledgeBaseHint = true,
  onSelect
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const highlightedKey = highlighted ? composerMentionSuggestionKey(highlighted) : null
  const knowledgeSuggestions = suggestions.filter((item) => item.kind === 'knowledge-base')
  const fileSuggestions = suggestions.filter((item) => item.kind === 'file-reference')

  useEffect(() => {
    if (!highlightedKey) return
    syncComposerMenuScroll(menuRef.current, itemRefs.current.get(highlightedKey) ?? null)
  }, [highlightedKey, selectedIndex, suggestions.length])

  return (
    <div className="ds-card-strong absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[680px] -translate-x-1/2 overflow-hidden rounded-[16px] p-1.5 shadow-[0_18px_46px_rgba(20,47,95,0.14)]">
      <div className="flex h-7 items-center gap-2 px-2.5 text-[11.5px] font-semibold text-ds-muted">
        <FileText className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
        <span>{t('composerMentionMenuTitle')}</span>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-faint" strokeWidth={1.9} /> : null}
      </div>
      {suggestions.length > 0 || (knowledgeBaseHint && !hasMountedKnowledgeBases) ? (
        <div
          ref={menuRef}
          className="flex max-h-[min(280px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1"
        >
          {knowledgeSuggestions.length > 0 ? (
            <div className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint">
              {t('knowledgeBaseTitle')}
            </div>
          ) : knowledgeBaseHint && !hasMountedKnowledgeBases ? (
            <div className="mx-1 mb-1 rounded-[10px] bg-ds-hover px-2.5 py-2 text-[11.5px] text-ds-faint">
              {t('composerKnowledgeMentionEmpty')}
            </div>
          ) : null}
          {knowledgeSuggestions.map((suggestion) => {
            const referenceKey = composerMentionSuggestionKey(suggestion)
            const active = highlightedKey === referenceKey
            return (
              <button
                key={referenceKey}
                ref={(node) => {
                  if (node) itemRefs.current.set(referenceKey, node)
                  else itemRefs.current.delete(referenceKey)
                }}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(suggestion)}
                className={`flex min-h-[46px] w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition ${
                  active
                    ? 'bg-ds-hover text-ds-ink shadow-[inset_0_0_0_1px_rgba(20,47,95,0.06)]'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                  active ? 'bg-white text-accent shadow-sm dark:bg-ds-card' : 'bg-ds-hover text-ds-muted'
                }`}>
                  <BookOpen className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold leading-5 text-inherit">
                    {suggestion.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] leading-4 text-ds-faint">
                    {suggestion.status
                      ? t(`knowledgeBaseStatus_${suggestion.status}`)
                      : t('knowledgeBaseDescription')}
                  </span>
                </span>
                <span className="hidden max-w-[170px] shrink-0 truncate rounded-full border border-ds-border-muted px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-ds-faint sm:block">
                  {formatComposerKnowledgeBaseMentionToken(suggestion.name)}
                </span>
              </button>
            )
          })}
          {fileSuggestions.length > 0 ? (
            <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint">
              {t('composerFileMentionMenuTitle')}
            </div>
          ) : null}
          {fileSuggestions.map((suggestion) => {
            const reference = suggestion.reference
            const isDirectory = isComposerDirectoryReference(reference)
            const referenceKey = composerMentionSuggestionKey(suggestion)
            const active = highlightedKey === referenceKey
            return (
              <button
                key={`${reference.type ?? 'file'}:${reference.relativePath}`}
                ref={(node) => {
                  if (node) itemRefs.current.set(referenceKey, node)
                  else itemRefs.current.delete(referenceKey)
                }}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(suggestion)}
                className={`flex min-h-[46px] w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition ${
                  active
                    ? 'bg-ds-hover text-ds-ink shadow-[inset_0_0_0_1px_rgba(20,47,95,0.06)]'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                    active ? 'bg-white text-accent shadow-sm dark:bg-ds-card' : 'bg-ds-hover text-ds-muted'
                  }`}
                >
                  {isDirectory
                    ? <Folder className="h-4 w-4" strokeWidth={1.8} />
                    : <FileText className="h-4 w-4" strokeWidth={1.8} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold leading-5 text-inherit">
                    {isDirectory ? `${reference.name}/` : reference.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] leading-4 text-ds-faint">
                    {isDirectory ? `${reference.relativePath}/` : reference.relativePath}
                  </span>
                </span>
                <span className="hidden max-w-[170px] shrink-0 truncate rounded-full border border-ds-border-muted px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-ds-faint sm:block">
                  {formatComposerFileMentionToken(reference.relativePath, isDirectory)}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-ds-border-muted px-3 py-3 text-[12px] text-ds-faint">
          {loading ? t('composerFileMentionLoading') : t('composerFileMentionEmpty')}
        </div>
      )}
    </div>
  )
}
