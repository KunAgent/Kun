import { useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ChartLine, FileText, Image as ImageIcon, MessageSquare, Palette, Presentation, Shapes, Table2, type LucideIcon } from 'lucide-react'
import { useArtifactThumbnail } from './artifact-thumbnail'
import { DataReportThumbnail } from './DataReportThumbnail'
import { LIBRARY_ARTIFACT_KIND_STYLE, type LibraryArtifact, type LibraryArtifactKind } from './artifact-types'
import { ARTIFACT_KIND_LABEL_KEYS, fileTypeLabel, formatArtifactSize, formatArtifactTime } from './artifact-view-model'

export const ARTIFACT_KIND_ICONS: Record<LibraryArtifactKind, LucideIcon> = {
  design: Palette,
  doc: FileText,
  slides: Presentation,
  report: ChartLine,
  sheet: Table2,
  board: Shapes,
  image: ImageIcon
}

const imageCache = new Map<string, string>()
const IMAGE_CACHE_LIMIT = 60

/** Small data URL for an image artifact, read once per window. */
export function useArtifactImage(artifact: LibraryArtifact | null): string {
  const key = artifact?.kind === 'image' ? artifact.id : ''
  const [dataUrl, setDataUrl] = useState(() => (key ? imageCache.get(key) ?? '' : ''))
  useEffect(() => {
    if (!artifact || !key) { setDataUrl(''); return }
    const cached = imageCache.get(key)
    if (cached) { setDataUrl(cached); return }
    let cancelled = false
    void window.kunGui?.readWorkspaceImage?.({ workspaceRoot: artifact.workspaceRoot, path: artifact.path })
      .then((result) => {
        if (cancelled || !result?.ok) return
        if (imageCache.size >= IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value as string)
        imageCache.set(key, result.dataUrl)
        setDataUrl(result.dataUrl)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [artifact, key])
  return dataUrl
}

/** White "sheet" that holds a preview; it rises from the bottom edge of the tinted ground. */
const FRAME = 'absolute overflow-hidden border border-b-0 border-black/[0.08] bg-white shadow-[0_6px_20px_rgba(24,24,27,0.08)] dark:border-white/10 dark:bg-zinc-900'
const PAGE_FRAME = `${FRAME} inset-x-7 bottom-0 top-[22px] rounded-t-[10px]`
const PAPER_FRAME = `${FRAME} inset-x-16 bottom-0 top-[22px]`
const SHEET_FRAME = `${FRAME} bottom-0 left-7 right-0 top-[22px] rounded-tl-[10px] border-r-0`

function ScreensThumbnail({ urls, total }: { urls: string[]; total: number }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <>
      <span className={`${PAGE_FRAME} grid grid-cols-3 content-start gap-2.5 bg-zinc-100 p-4 dark:bg-zinc-800`}>
        {urls.map((url, index) => (
          <img key={index} src={url} alt="" draggable={false}
            className="aspect-[16/10] w-full rounded-[3px] bg-white object-cover object-top shadow-[0_1px_2px_rgba(24,24,27,0.14)]" />
        ))}
      </span>
      <span className="absolute right-3 top-2.5 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-zinc-900/80 dark:text-violet-200">
        {t('artifactsScreenCount', { n: total })}
      </span>
    </>
  )
}

function CsvThumbnail({ rows }: { rows: string[][] }): ReactElement {
  const columns = Math.max(...rows.map((row) => row.length))
  return (
    <span className={`${SHEET_FRAME} block`}>
      <table className="w-full table-fixed border-collapse text-[10px] leading-tight text-zinc-700 dark:text-zinc-300">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex === 0 ? 'bg-green-50 font-semibold dark:bg-green-400/10' : ''}>
              {Array.from({ length: columns }, (_, column) => (
                <td key={column} className="truncate border-b border-r border-zinc-200 px-1.5 py-1 dark:border-zinc-700">{row[column] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  )
}

function Thumbnail({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  // Reports draw their own figures and charts from the report file.
  if (artifact.kind === 'report') return <DataReportThumbnail artifact={artifact} />
  return <RenderedThumbnail artifact={artifact} />
}

function RenderedThumbnail({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const thumbnail = useArtifactThumbnail(artifact)
  const Icon = ARTIFACT_KIND_ICONS[artifact.kind]
  if (thumbnail.status === 'loading') {
    return <span aria-hidden className={`${artifact.kind === 'image' ? 'absolute inset-0 bg-white/50 dark:bg-white/5' : PAGE_FRAME} animate-pulse`} />
  }
  if (thumbnail.status === 'empty') {
    return (
      <span className="flex h-[52px] w-[52px] rounded-[14px] bg-white shadow-[0_4px_14px_rgba(24,24,27,0.08)] dark:bg-zinc-900">
        <span className={`flex h-full w-full items-center justify-center rounded-[14px] ${LIBRARY_ARTIFACT_KIND_STYLE[artifact.kind].tile}`}>
          <Icon className="h-6 w-6" aria-hidden />
        </span>
      </span>
    )
  }
  if (thumbnail.status === 'screens') return <ScreensThumbnail urls={thumbnail.urls} total={thumbnail.total} />
  if (thumbnail.status === 'table') return <CsvThumbnail rows={thumbnail.rows} />
  const { url } = thumbnail
  switch (artifact.kind) {
    case 'image':
      return <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
    case 'slides':
      return <img src={url} alt="" draggable={false} className="max-h-[148px] max-w-[80%] rounded-md bg-white shadow-[0_10px_28px_rgba(24,24,27,0.22)]" />
    case 'doc':
      return <span className={PAPER_FRAME}><img src={url} alt="" draggable={false} className="h-full w-full object-cover object-top" /></span>
    case 'sheet':
      return <span className={SHEET_FRAME}><img src={url} alt="" draggable={false} className="h-full w-full object-cover object-left-top" /></span>
    case 'board':
      return <span className={PAGE_FRAME}><img src={url} alt="" draggable={false} className="h-full w-full object-contain p-3" /></span>
    default:
      return <span className={PAGE_FRAME}><img src={url} alt="" draggable={false} className="h-full w-full object-cover object-left-top" /></span>
  }
}

/**
 * Defers a card thumbnail until the card is near the viewport. Board previews
 * read a scene and render a PNG, so a long grid must not load every preview
 * as soon as the page opens.
 */
function useLazyThumbnail(): { ref: RefObject<HTMLSpanElement | null>; visible: boolean } {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])
  return { ref, visible }
}

export function ArtifactKindChip({ kind, className = '' }: { kind: LibraryArtifactKind; className?: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${LIBRARY_ARTIFACT_KIND_STYLE[kind].chip} ${className}`}>
      {t(ARTIFACT_KIND_LABEL_KEYS[kind])}
    </span>
  )
}

export function ArtifactCard({ artifact, sourceTitle, onOpen }: {
  artifact: LibraryArtifact
  sourceTitle?: string
  onOpen: (artifact: LibraryArtifact) => void
}): ReactElement {
  const { i18n } = useTranslation('common')
  const meta = [artifact.projectName, fileTypeLabel(artifact) || null].filter(Boolean).join(' · ')
  const thumbnailVisible = useLazyThumbnail()
  const style = LIBRARY_ARTIFACT_KIND_STYLE[artifact.kind]
  const Icon = ARTIFACT_KIND_ICONS[artifact.kind]
  return (
    <button
      type="button"
      data-artifact-card={artifact.kind}
      onClick={() => onOpen(artifact)}
      className="ds-no-drag group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-left transition hover:border-ds-border-strong hover:shadow-[0_10px_30px_rgba(24,24,27,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span
        ref={thumbnailVisible.ref}
        data-artifact-thumbnail
        className={`relative flex h-[200px] items-center justify-center overflow-hidden ${style.canvas}`}
      >
        {thumbnailVisible.visible ? <Thumbnail artifact={artifact} /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-3 px-4 pb-4 pt-3.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${style.tile}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[15px] font-semibold text-ds-ink">{artifact.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ds-muted">
            <span className="truncate">{meta}</span>
            <span aria-hidden className="shrink-0">·</span>
            <span className="shrink-0">{formatArtifactTime(artifact.updatedAt, i18n.language)}</span>
          </span>
          {sourceTitle ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ds-muted">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{sourceTitle}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

export function ArtifactListRow({ artifact, sourceTitle, onOpen, actions }: {
  artifact: LibraryArtifact
  sourceTitle?: string
  onOpen: (artifact: LibraryArtifact) => void
  actions?: ReactNode
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const Icon = ARTIFACT_KIND_ICONS[artifact.kind]
  return (
    <tr className="border-t border-ds-border-muted hover:bg-ds-hover" data-artifact-row={artifact.kind}>
      <td className="px-4 py-2.5">
        <button type="button" onClick={() => onOpen(artifact)} className="ds-no-drag flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${LIBRARY_ARTIFACT_KIND_STYLE[artifact.kind].tile}`}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="truncate text-[13.5px] font-semibold text-ds-ink">{artifact.title}</span>
        </button>
      </td>
      <td className="px-4 py-2.5 text-[13px] text-ds-muted">{t(ARTIFACT_KIND_LABEL_KEYS[artifact.kind])}</td>
      <td className="max-w-[240px] truncate px-4 py-2.5 text-[13px] text-ds-muted">{artifact.projectName}</td>
      <td className="max-w-[260px] truncate px-4 py-2.5 text-[13px] text-ds-muted">{sourceTitle ?? ''}</td>
      <td className="px-4 py-2.5 text-[13px] text-ds-muted">{formatArtifactSize(artifact.size)}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ds-muted">{formatArtifactTime(artifact.updatedAt, i18n.language)}</td>
      {actions !== undefined ? <td className="px-2 py-2.5 text-right">{actions}</td> : null}
    </tr>
  )
}
