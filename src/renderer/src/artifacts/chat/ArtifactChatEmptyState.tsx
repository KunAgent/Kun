import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RoomAvatar } from '../../components/rooms/RoomAvatar'
import { writeBasenameFromPath } from '../../write/write-workspace-store-helpers'
import type { LibraryArtifact } from '../artifact-types'

const QUICK_ACTIONS: Record<'slides' | 'doc' | 'sheet', readonly string[]> = {
  slides: ['SlidesLayout', 'SlidesStyle', 'SlidesNotes', 'SlidesSplit'],
  doc: ['DocProofread', 'DocFormal', 'DocSummary', 'DocTerms'],
  sheet: ['SheetExplain', 'SheetTotals', 'SheetOutliers', 'SheetChart']
}

export function artifactChatKind(artifact: Pick<LibraryArtifact, 'kind'>): 'slides' | 'doc' | 'sheet' {
  return artifact.kind === 'slides' ? 'slides' : artifact.kind === 'sheet' ? 'sheet' : 'doc'
}

/** First view of the panel: what this file is, where the conversation runs, and a few starters. */
export function ArtifactChatEmptyState({ artifact, sourceTitle, onPick }: {
  artifact: LibraryArtifact
  sourceTitle: string | null
  onPick: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const kind = artifactChatKind(artifact)
  const title = kind === 'slides' ? t('artifactChatEmptyTitleSlides')
    : kind === 'sheet' ? t('artifactChatEmptyTitleSheet') : t('artifactChatEmptyTitleDoc')
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center" data-artifact-chat-empty>
      <RoomAvatar label="Kun" size={48} />
      <span className="text-[14px] font-semibold text-ds-ink">{title}</span>
      <span className="max-w-[300px] text-[12.5px] leading-relaxed text-ds-muted">
        {sourceTitle
          ? t('artifactChatEmptySource', { title: sourceTitle })
          : t('artifactChatEmptyNew', { project: artifact.projectName, file: writeBasenameFromPath(artifact.path) })}
      </span>
      <div className="mt-2 grid w-full max-w-[320px] grid-cols-2 gap-2">
        {QUICK_ACTIONS[kind].map((name) => (
          <button key={name} type="button" onClick={() => onPick(t(`artifactChatQuickPrompt${name}`))}
            className="min-h-9 rounded-xl border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12.5px] text-ds-ink hover:bg-ds-hover">
            {t(`artifactChatQuickLabel${name}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
