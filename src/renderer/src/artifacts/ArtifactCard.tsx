import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Image as ImageIcon, MessageSquare, Palette, Presentation, Shapes, Table2, type LucideIcon } from 'lucide-react'
import { useBoardPreview } from './artifact-board-preview'
import { LIBRARY_ARTIFACT_KIND_STYLE, type LibraryArtifact, type LibraryArtifactKind } from './artifact-types'
import { ARTIFACT_KIND_LABEL_KEYS, fileTypeLabel, formatArtifactSize, formatArtifactTime } from './artifact-view-model'

export const ARTIFACT_KIND_ICONS: Record<LibraryArtifactKind, LucideIcon> = {
  design: Palette,
  doc: FileText,
  slides: Presentation,
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

function Thumbnail({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const image = useArtifactImage(artifact)
  const board = useBoardPreview(artifact.kind === 'board' ? artifact : null)
  if (artifact.kind === 'image') {
    return image
      ? <img src={image} alt="" className="h-full w-full object-cover" draggable={false} />
      : <div className="h-full w-full bg-pink-50 dark:bg-pink-400/10" />
  }
  if (artifact.kind === 'design') {
    return (
      <div className="flex items-start gap-2.5">
        <div className="flex h-[118px] w-[86px] flex-col gap-1.5 rounded-md border border-ds-border bg-white p-2 dark:bg-ds-card">
          <div className="h-2 w-10 rounded bg-zinc-300 dark:bg-zinc-600" /><div className="flex-1 rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-3.5 w-12 self-end rounded-full bg-violet-500" />
        </div>
        <div className="flex h-[118px] w-[86px] flex-col gap-1.5 rounded-md border border-ds-border bg-white p-2 dark:bg-ds-card">
          <div className="h-2 w-14 rounded bg-zinc-300 dark:bg-zinc-600" /><div className="h-1.5 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-1.5 w-2/3 rounded bg-zinc-200 dark:bg-zinc-700" /><div className="mt-auto h-6 rounded bg-violet-50 dark:bg-violet-400/15" />
        </div>
      </div>
    )
  }
  if (artifact.kind === 'slides') {
    return (
      <div className="flex h-[118px] w-[210px] flex-col gap-2 rounded-md bg-zinc-900 p-4">
        <div className="h-1.5 w-8 rounded bg-orange-400" /><div className="h-3 w-32 rounded bg-white" />
        <div className="h-2 w-24 rounded bg-zinc-500" />
        <div className="mt-auto flex gap-1.5"><div className="h-6 flex-1 rounded bg-zinc-700" /><div className="h-6 flex-1 rounded bg-zinc-700" /><div className="h-6 flex-1 rounded bg-zinc-700" /></div>
      </div>
    )
  }
  if (artifact.kind === 'sheet') {
    return (
      <div className="grid w-[200px] grid-cols-4 overflow-hidden rounded border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-ds-card">
        {Array.from({ length: 16 }, (_, index) => (
          <div key={index} className={`h-5 border-b border-r border-zinc-200 dark:border-zinc-700 ${index < 4 ? 'bg-green-50 dark:bg-green-400/15' : ''}`} />
        ))}
      </div>
    )
  }
  if (artifact.kind === 'board' && board.url) {
    return <img src={board.url} alt="" className="h-full w-full bg-white object-contain p-3" draggable={false} />
  }
  if (artifact.kind === 'board') {
    return (
      <div className="flex items-center">
        <div className="h-8 w-14 rounded-md border-[1.5px] border-teal-600 bg-white dark:bg-ds-card" /><div className="h-[1.5px] w-7 bg-teal-600" />
        <div className="h-8 w-14 rounded-md border-[1.5px] border-teal-600 bg-teal-50 dark:bg-teal-400/15" /><div className="h-[1.5px] w-7 bg-teal-600" />
        <div className="h-12 w-12 rounded-full border-[1.5px] border-teal-600 bg-white dark:bg-ds-card" />
      </div>
    )
  }
  return (
    <div className="mt-8 flex h-[148px] w-[112px] flex-col gap-1.5 rounded border border-ds-border bg-white px-3 py-3.5 dark:bg-ds-card">
      <div className="h-2 w-16 rounded bg-blue-600" />
      {[100, 100, 80, 100, 60].map((width, index) => <div key={index} className="h-1.5 rounded bg-zinc-200 dark:bg-zinc-700" style={{ width: `${width}%` }} />)}
    </div>
  )
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
  return (
    <button
      type="button"
      data-artifact-card={artifact.kind}
      onClick={() => onOpen(artifact)}
      className="ds-no-drag group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-left transition hover:border-ds-border-strong hover:shadow-[0_10px_30px_rgba(24,24,27,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="relative flex h-[176px] items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-900/60">
        <Thumbnail artifact={artifact} />
        <ArtifactKindChip kind={artifact.kind} className="absolute bottom-3 left-3 ring-1 ring-white dark:ring-transparent" />
      </span>
      <span className="flex min-w-0 flex-col gap-1.5 px-4 pb-4 pt-3.5">
        <span className="truncate text-[15px] font-semibold text-ds-ink">{artifact.title}</span>
        <span className="truncate text-[12.5px] text-ds-muted">{meta}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ds-muted">
          {sourceTitle ? <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          <span className="truncate">{sourceTitle ?? ''}</span>
          <span className="ml-auto shrink-0">{formatArtifactTime(artifact.updatedAt, i18n.language)}</span>
        </span>
      </span>
    </button>
  )
}

export function ArtifactListRow({ artifact, sourceTitle, onOpen }: {
  artifact: LibraryArtifact
  sourceTitle?: string
  onOpen: (artifact: LibraryArtifact) => void
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
    </tr>
  )
}
