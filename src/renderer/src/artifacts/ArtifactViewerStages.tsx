import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, Maximize, Minus, Palette, Plus, Shapes } from 'lucide-react'
import { useWorkspaceOfficePreview } from '../components/useWorkspaceOfficePreview'
import { WorkspaceOfficePreview } from '../components/WorkspaceOfficePreview'
import { DesignHtmlPreviewHost } from '../components/design/DesignHtmlPreviewHost'
import { parseArtifactMeta } from '../design/design-artifact-persistence'
import type { DesignArtifact } from '../design/design-types'
import { officePreviewable, type LibraryArtifact } from './artifact-types'
import { useArtifactImage } from './ArtifactCard'
import { openDesignCanvas, openWhiteboard, revealArtifact } from './artifact-actions'

export type DesignScreen = Pick<DesignArtifact, 'id' | 'title' | 'relativePath' | 'versions'>

/** Floating control pill shared by every stage. */
export function StagePill({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div role="toolbar" aria-label={label}
      className="ds-no-drag absolute bottom-6 left-1/2 z-10 flex h-11 -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full border border-ds-border bg-ds-card px-1.5 shadow-[0_8px_24px_rgba(24,24,27,0.14)]">
      {children}
    </div>
  )
}

export function PillDivider(): ReactElement {
  return <span aria-hidden className="mx-1.5 h-5 w-px bg-ds-border" />
}

export function PillButton({ label, onClick, children, active = false }: {
  label: string
  onClick?: () => void
  children: ReactNode
  active?: boolean
}): ReactElement {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] ${active ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}>
      {children}
    </button>
  )
}

function StageMessage({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-[13.5px] text-ds-muted">{children}</div>
}

export function OfficeStage({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const { t } = useTranslation('common')
  const target = useMemo(() => ({ path: artifact.path, workspaceRoot: artifact.workspaceRoot }), [artifact.path, artifact.workspaceRoot])
  const previewable = officePreviewable(artifact.path)
  const { officeResult, officeLoading, officeRefreshError } = useWorkspaceOfficePreview({
    target: previewable ? target : null,
    workspaceRoot: artifact.workspaceRoot,
    enabled: previewable
  })
  if (!previewable) return <FallbackStage artifact={artifact} />
  if (!officeResult) {
    return <StageMessage><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t('artifactsPreviewLoading')}</StageMessage>
  }
  if (!officeResult.ok) return <FallbackStage artifact={artifact} detail={officeResult.message} />
  return (
    <div className="h-full min-h-0 overflow-hidden p-6" data-artifact-stage="office">
      <div className="h-full min-h-0 overflow-hidden rounded-xl border border-ds-border bg-ds-card shadow-[0_16px_40px_rgba(24,24,27,0.08)]">
        <WorkspaceOfficePreview result={officeResult} loading={officeLoading} refreshError={officeRefreshError} />
      </div>
    </div>
  )
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2]

export function ImageStage({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const { t } = useTranslation('common')
  const image = useArtifactImage(artifact)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const step = (direction: 1 | -1): void => {
    const current = zoom === 'fit' ? 1 : zoom
    const index = ZOOM_STEPS.findIndex((value) => value >= current)
    const next = ZOOM_STEPS[Math.min(Math.max((index < 0 ? ZOOM_STEPS.length - 1 : index) + direction, 0), ZOOM_STEPS.length - 1)]
    setZoom(next)
  }
  return (
    <div className="relative h-full min-h-0 overflow-auto bg-zinc-900" data-artifact-stage="image">
      <div className="flex min-h-full min-w-full items-center justify-center p-10 pb-24">
        {image ? (
          <img src={image} alt={artifact.title} draggable={false}
            className="rounded-lg shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
            style={zoom === 'fit' ? { maxWidth: '100%', maxHeight: 'calc(100vh - 260px)' } : { width: 'auto', transform: `scale(${zoom})`, transformOrigin: 'center' }} />
        ) : <Loader2 className="h-5 w-5 animate-spin text-zinc-400" aria-label={t('artifactsPreviewLoading')} />}
      </div>
      <StagePill label={t('artifactsStageControls')}>
        <PillButton label={t('artifactsZoomOut')} onClick={() => step(-1)}><Minus className="h-4 w-4" aria-hidden /></PillButton>
        <span className="min-w-12 text-center text-[13px] tabular-nums text-ds-ink">{zoom === 'fit' ? t('artifactsFit') : `${Math.round(zoom * 100)}%`}</span>
        <PillButton label={t('artifactsZoomIn')} onClick={() => step(1)}><Plus className="h-4 w-4" aria-hidden /></PillButton>
        <PillDivider />
        <PillButton label={t('artifactsFit')} active={zoom === 'fit'} onClick={() => setZoom('fit')}><Maximize className="h-4 w-4" aria-hidden /></PillButton>
      </StagePill>
    </div>
  )
}

async function loadDesignScreens(artifact: LibraryArtifact): Promise<DesignScreen[]> {
  const api = window.kunGui
  if (!api?.listWorkspaceDirectory || !api.readWorkspaceFile) return []
  const listing = await api.listWorkspaceDirectory({ workspaceRoot: artifact.workspaceRoot, path: artifact.path })
  if (!listing.ok) return []
  const metas = await Promise.all(listing.entries.filter((entry) => entry.type === 'directory').map(async (entry) => {
    const dir = `${artifact.path}/${entry.name}`
    const read = await api.readWorkspaceFile({ workspaceRoot: artifact.workspaceRoot, path: `${dir}/meta.json` }).catch(() => null)
    return read?.ok ? parseArtifactMeta(read.content, entry.name, dir) : null
  }))
  return metas
    .filter((meta): meta is DesignArtifact => Boolean(meta && meta.kind === 'html' && meta.relativePath))
    .sort((left, right) => (left.node?.y ?? 0) - (right.node?.y ?? 0) || (left.node?.x ?? 0) - (right.node?.x ?? 0) || left.createdAt.localeCompare(right.createdAt))
}

export function useDesignScreens(artifact: LibraryArtifact, enabled: boolean): { screens: DesignScreen[]; loading: boolean } {
  const [state, setState] = useState<{ screens: DesignScreen[]; loading: boolean }>({ screens: [], loading: enabled })
  useEffect(() => {
    if (!enabled) { setState({ screens: [], loading: false }); return }
    let cancelled = false
    setState({ screens: [], loading: true })
    void loadDesignScreens(artifact).catch(() => []).then((screens) => {
      if (!cancelled) setState({ screens, loading: false })
    })
    return () => { cancelled = true }
  }, [artifact, enabled])
  return state
}

const SCREEN_SCALES = [0.25, 0.35, 0.5]

export function DesignStage({ artifact, screens, loading, selectedId, onSelect }: {
  artifact: LibraryArtifact
  screens: DesignScreen[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [scaleIndex, setScaleIndex] = useState(1)
  const scale = SCREEN_SCALES[scaleIndex]
  const width = Math.round(1280 * scale)
  const height = Math.round(800 * scale)
  return (
    <div className="relative h-full min-h-0 overflow-auto bg-zinc-100 [background-image:radial-gradient(rgb(212_212_216)_1px,transparent_1px)] [background-size:20px_20px] dark:bg-zinc-900 dark:[background-image:radial-gradient(rgb(63_63_70)_1px,transparent_1px)]" data-artifact-stage="design">
      {loading ? (
        <StageMessage><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t('artifactsPreviewLoading')}</StageMessage>
      ) : screens.length === 0 ? (
        <StageMessage>
          <Palette className="h-6 w-6 text-violet-500" aria-hidden />
          <span>{t('artifactsNoScreens')}</span>
          <button type="button" onClick={() => void openDesignCanvas(artifact)} className="rounded-full bg-ds-ink px-4 py-1.5 text-[13px] font-semibold text-ds-main">{t('artifactsOpenCanvas')}</button>
        </StageMessage>
      ) : (
        <div className="flex flex-wrap content-start gap-x-8 gap-y-10 p-12 pb-28">
          {screens.map((screen) => {
            const selected = screen.id === selectedId
            return (
              <button key={screen.id} type="button" onClick={() => onSelect(screen.id)} aria-pressed={selected}
                className="ds-no-drag flex flex-col gap-2 text-left">
                <span className={`max-w-full truncate text-[12.5px] ${selected ? 'font-semibold text-accent' : 'text-ds-muted'}`} style={{ width }}>{screen.title}</span>
                <span className={`block overflow-hidden rounded-md bg-white shadow-[0_1px_3px_rgba(24,24,27,0.12)] ${selected ? 'outline outline-2 outline-offset-[3px] outline-accent' : ''}`} style={{ width, height }}>
                  <span className="pointer-events-none block h-full w-full">
                    <DesignHtmlPreviewHost workspaceRoot={artifact.workspaceRoot} relativePath={screen.relativePath} enabled
                      partition={`kun-artifact-screen-${screen.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}`} zoom={scale} mountWhileSkeleton>
                      {({ state, renderWebview }) => state.webviewUrl
                        ? renderWebview({ className: 'h-full w-full border-0 bg-white', style: { height: '100%', width: '100%' }, title: screen.title })
                        : <span className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-ds-muted" aria-hidden /></span>}
                    </DesignHtmlPreviewHost>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
      <StagePill label={t('artifactsStageControls')}>
        <PillButton label={t('artifactsZoomOut')} onClick={() => setScaleIndex(Math.max(scaleIndex - 1, 0))}><Minus className="h-4 w-4" aria-hidden /></PillButton>
        <span className="min-w-12 text-center text-[13px] tabular-nums text-ds-ink">{Math.round(scale * 100)}%</span>
        <PillButton label={t('artifactsZoomIn')} onClick={() => setScaleIndex(Math.min(scaleIndex + 1, SCREEN_SCALES.length - 1))}><Plus className="h-4 w-4" aria-hidden /></PillButton>
        <PillDivider />
        <PillButton label={t('artifactsOpenCanvas')} onClick={() => void openDesignCanvas(artifact)}>
          <Palette className="h-4 w-4" aria-hidden /><span className="pr-1">{t('artifactsOpenCanvas')}</span>
        </PillButton>
      </StagePill>
    </div>
  )
}

export function BoardStage({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="h-full bg-zinc-100 [background-image:radial-gradient(rgb(212_212_216)_1px,transparent_1px)] [background-size:20px_20px] dark:bg-zinc-900 dark:[background-image:radial-gradient(rgb(63_63_70)_1px,transparent_1px)]" data-artifact-stage="board">
      <StageMessage>
        <Shapes className="h-7 w-7 text-teal-600" aria-hidden />
        <span className="max-w-[360px]">{t('artifactsWhiteboardHint')}</span>
        <button type="button" onClick={() => void openWhiteboard(artifact)} className="rounded-full bg-ds-ink px-4 py-1.5 text-[13px] font-semibold text-ds-main">{t('artifactsOpenWork')}</button>
      </StageMessage>
    </div>
  )
}

export function FallbackStage({ artifact, detail }: { artifact: LibraryArtifact; detail?: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <StageMessage>
      <span>{t('artifactsPreviewUnavailable')}</span>
      {detail ? <span className="max-w-[420px] text-[12px] text-ds-faint">{detail}</span> : null}
      <button type="button" onClick={() => void revealArtifact(artifact)} className="flex items-center gap-1.5 rounded-full border border-ds-border px-4 py-1.5 text-[13px] text-ds-ink hover:bg-ds-hover">
        <FolderOpen className="h-4 w-4" aria-hidden />{t('artifactsReveal')}
      </button>
    </StageMessage>
  )
}
