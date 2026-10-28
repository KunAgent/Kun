import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ChevronLeft, FolderOpen, Loader2, MessageSquare, Palette, Shapes } from 'lucide-react'
import { SidebarTitlebarToggleButton } from '../components/sidebar/SidebarPrimitives'
import { useChatStore } from '../store/chat-store'
import { useArtifactLibraryStore } from './artifact-library-store'
import { askKunToRevise, openDesignCanvas, openSourceConversation, openWhiteboard, revealArtifact, sourceThreadFor } from './artifact-actions'
import type { LibraryArtifact } from './artifact-types'
import { fileTypeLabel, formatArtifactSize } from './artifact-view-model'
import { ArtifactKindChip } from './ArtifactCard'
import { ArtifactDetails } from './ArtifactDetails'
import { DataReportStage } from './DataReportStage'
import { BoardStage, DesignStage, ImageStage, OfficeStage, PdfStage, useDesignScreens, type DesignScreen } from './ArtifactViewerStages'
import { ArtifactOfficeWorkspace, artifactHasOfficeChat } from './chat/ArtifactOfficeWorkspace'
import type { ArtifactChatHost } from './chat/use-artifact-office-session'

function TopBarButton({ label, onClick, children, iconOnly = false }: {
  label: string
  onClick: () => void
  children: ReactElement | ReactElement[]
  iconOnly?: boolean
}): ReactElement {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={`flex h-8 items-center gap-1.5 rounded-lg text-[13px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink ${iconOnly ? 'w-8 justify-center' : 'px-2.5'}`}>
      {children}
    </button>
  )
}

type PanelVersion = { name: string; note: string; current: boolean }

function ArtifactPanel({ artifact, versions, focus, showRevise = true }: {
  artifact: LibraryArtifact
  versions: PanelVersion[]
  focus: string
  showRevise?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [tab, setTab] = useState<'info' | 'versions'>('info')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const send = async (): Promise<void> => {
    if (!draft.trim() || sending) return
    setSending(true)
    const sent = await askKunToRevise(artifact, draft, focus || undefined).catch(() => false)
    setSending(false)
    if (sent) setDraft('')
  }
  return (
    <aside aria-label={t('artifactsDetails')} className="ds-no-drag flex min-h-0 w-full shrink-0 flex-col gap-5 overflow-y-auto border-ds-border bg-ds-card p-5 lg:w-[320px] lg:border-l">
      <div role="tablist" className="grid grid-cols-2 gap-0.5 rounded-xl bg-ds-hover p-[3px]">
        {(['info', 'versions'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`h-[30px] rounded-[9px] text-[13px] ${tab === id ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted'}`}>
            {t(id === 'info' ? 'artifactsDetails' : 'artifactsVersions')}
          </button>
        ))}
      </div>
      {tab === 'info' ? (
        <ArtifactDetails artifact={artifact} />
      ) : versions.length === 0 ? (
        <p className="text-[13px] text-ds-muted">{t('artifactsNoVersions')}</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {versions.map((version) => (
            <li key={version.name} className={`flex items-start gap-2.5 rounded-xl p-2.5 ${version.current ? 'bg-ds-hover' : ''}`}>
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${version.current ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-ds-ink">{version.name}</span>
                <span className="text-[12.5px] text-ds-muted">{version.note}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-auto flex flex-col gap-2">
        <span className="text-[12.5px] font-semibold text-ds-ink">{t('artifactsReviseTitle')}</span>
        {showRevise ? (
        <label className="flex flex-col gap-2.5 rounded-2xl border border-ds-border bg-ds-card p-3 shadow-sm">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} aria-label={t('artifactsReviseTitle')}
            placeholder={t('artifactsRevisePlaceholder')}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send() }}
            className="resize-none bg-transparent text-[13px] leading-relaxed text-ds-ink outline-none placeholder:text-ds-faint" />
          <span className="flex items-center gap-2">
            <span className="max-w-[190px] truncate rounded-md bg-ds-hover px-2 py-0.5 text-[12px] text-ds-muted">{focus || t('artifactsWholeFile')}</span>
            <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label={t('artifactsReviseSend')}
              className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ds-ink text-ds-main disabled:opacity-40">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUp className="h-4 w-4" aria-hidden />}
            </button>
          </span>
        </label>
        ) : null}
        <span className="text-[12px] text-ds-muted">{t('artifactsReviseHint')}</span>
      </div>
    </aside>
  )
}

function designVersions(screens: DesignScreen[], t: (key: string, options?: Record<string, unknown>) => string): PanelVersion[] {
  return screens.map((screen) => ({
    name: screen.title,
    note: t('artifactsScreenVersions', { count: Math.max(screen.versions.length, 1) }),
    current: false
  }))
}

export function ArtifactViewer({ artifact, leftSidebarCollapsed, onToggleLeftSidebar, chat, mode = 'code' }: {
  artifact: LibraryArtifact
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  /** The Code conversation the Office chat panel runs on; without it the classic panel shows. */
  chat?: ArtifactChatHost
  /** Work keeps the viewer read-only: revisions belong to the Work conversation. */
  mode?: 'code' | 'work'
}): ReactElement {
  const { t } = useTranslation('common')
  const isWork = mode === 'work'
  const closeArtifact = useArtifactLibraryStore((state) => state.closeArtifact)
  const threads = useChatStore((state) => state.threads)
  const source = sourceThreadFor(artifact, threads)
  const isDesign = artifact.kind === 'design'
  const design = useDesignScreens(artifact, isDesign)
  const [selectedScreen, setSelectedScreen] = useState<string | null>(null)
  const focusScreen = isDesign ? design.screens.find((screen) => screen.id === selectedScreen) : undefined
  const officeChat = chat && artifactHasOfficeChat(artifact) ? chat : null
  const [chatOpen, setChatOpen] = useState(false)
  const meta = [fileTypeLabel(artifact), artifact.size !== undefined ? formatArtifactSize(artifact.size) : ''].filter(Boolean).join(' · ')

  const stage = isDesign
    ? <DesignStage artifact={artifact} screens={design.screens} loading={design.loading} selectedId={selectedScreen} onSelect={setSelectedScreen} />
    : artifact.kind === 'image'
      ? <ImageStage artifact={artifact} />
      : artifact.kind === 'board'
        ? <BoardStage artifact={artifact} />
        : artifact.kind === 'report'
          ? <DataReportStage artifact={artifact} />
          : artifact.ext === '.pdf'
            ? <PdfStage artifact={artifact} />
            : <OfficeStage artifact={artifact} />

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main" data-artifact-viewer={artifact.kind}>
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[52px] w-full flex-wrap items-center gap-3 rounded-[24px] px-3 py-1.5">
          <div className={`flex min-w-0 flex-1 items-center gap-2 ${leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
            {leftSidebarCollapsed ? (
              <SidebarTitlebarToggleButton onClick={onToggleLeftSidebar} title={t('sidebarExpand')} ariaLabel={t('sidebarExpand')} />
            ) : null}
            <button type="button" onClick={closeArtifact} aria-label={t('artifactsBack')} title={t('artifactsBack')}
              className="ds-no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
              <ChevronLeft className="h-[18px] w-[18px]" aria-hidden />
            </button>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] text-ds-muted">{t('artifactsTitle')} / {artifact.projectName}</span>
              <span className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-[15px] font-semibold text-ds-ink">{artifact.title}</h1>
                <ArtifactKindChip kind={artifact.kind} />
                {meta ? <span className="shrink-0 text-[12.5px] text-ds-muted">{meta}</span> : null}
              </span>
            </div>
          </div>
          <div className="ds-no-drag flex flex-wrap items-center gap-0.5">
            {isDesign ? (
              <TopBarButton label={t('artifactsOpenCanvas')} onClick={() => void openDesignCanvas(artifact)}>
                <Palette className="h-4 w-4" aria-hidden /><span>{t('artifactsOpenCanvas')}</span>
              </TopBarButton>
            ) : artifact.kind === 'board' ? (
              <TopBarButton label={t('artifactsOpenWork')} onClick={() => void openWhiteboard(artifact)}>
                <Shapes className="h-4 w-4" aria-hidden /><span>{t('artifactsOpenWork')}</span>
              </TopBarButton>
            ) : null}
            <TopBarButton label={t('artifactsReveal')} onClick={() => void revealArtifact(artifact)} iconOnly>
              <FolderOpen className="h-4 w-4" aria-hidden />
            </TopBarButton>
            {officeChat ? (
              <button type="button" onClick={() => setChatOpen((open) => !open)} aria-expanded={chatOpen}
                className="ml-1 flex h-[34px] items-center gap-1.5 rounded-full bg-ds-ink px-3.5 text-[13px] font-semibold text-ds-main lg:hidden">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />{t('artifactChatToggle')}
              </button>
            ) : source && !isWork ? (
              <>
                <span aria-hidden className="mx-2 h-5 w-px bg-ds-border" />
                <button type="button" onClick={() => void openSourceConversation(artifact)}
                  className="flex h-[34px] items-center gap-1.5 rounded-full bg-ds-ink px-3.5 text-[13px] font-semibold text-ds-main">
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />{t('artifactsContinue')}
                </button>
              </>
            ) : null}
          </div>
        </header>
      </div>
      {officeChat ? (
        <ArtifactOfficeWorkspace artifact={artifact} host={officeChat} chatOpen={chatOpen} onCloseChat={() => setChatOpen(false)} />
      ) : (
      <div className="ds-no-drag mt-3 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-ds-border lg:flex-row">
        <section aria-label={artifact.title} className="relative min-h-[420px] min-w-0 flex-1">{stage}</section>
        <ArtifactPanel
          artifact={artifact}
          versions={isDesign ? designVersions(design.screens, t) : []}
          focus={focusScreen?.title ?? ''}
          showRevise={!isWork}
        />
      </div>
      )}
    </div>
  )
}
