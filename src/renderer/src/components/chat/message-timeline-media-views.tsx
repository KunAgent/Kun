import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, Download, File, ImageIcon, Loader2, Video } from 'lucide-react'
import type { AttachmentReference, ChatBlock, GeneratedFileReference, RuntimeDisclosureMetadata, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { ImagePreviewLightbox } from './ImagePreviewLightbox'
import { isGeneratedDocumentArtifactPath } from './generated-document-artifacts'
import { useTimelineFilePreviewWorkspaceRoot } from './timeline-file-preview-workspace'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import { metaAttachmentReferences, metaStringArray } from './message-timeline-bubble-meta'
import {
  attachmentReferenceFromPreview,
  dataUrlPayload,
  formatByteSize,
  generatedMediaScrollAvailability,
  mediaIsImage,
  mediaIsVideo,
  mediaKey,
  mediaMime,
  mediaName,
  mediaPath,
  mediaTileDisplaySize,
  mediaTileFitConstraints,
  mergeMediaReferences,
  metaGeneratedFileReferences,
  useMediaPreviews,
  userMediaTileClass,
  type GeneratedMediaScrollAvailability,
  type TimelineMediaReference
} from './message-timeline-media-logic'

export function MediaPreviewTile({
  media,
  previewUrl,
  previewState,
  variant,
  mediaCount = 1
}: {
  media: TimelineMediaReference
  previewUrl?: string
  previewState?: 'loading' | 'failed'
  variant: 'user' | 'tool' | 'conversation'
  mediaCount?: number
}): ReactElement {
  const { t } = useTranslation('common')
  const globalWorkspaceRoot = useChatStore((s) => s.workspaceRoot)
  const timelineWorkspaceRoot = useTimelineFilePreviewWorkspaceRoot()
  const workspaceRoot = timelineWorkspaceRoot || globalWorkspaceRoot
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const unavailable = 'availability' in media && media.availability === 'unavailable'
  const title = mediaName(media)
  const filePath = mediaPath(media)
  const mimeType = media.mimeType || (mediaIsImage(media) ? 'image' : mediaIsVideo(media) ? 'video' : '')
  const byteSize = formatByteSize(media.byteSize)
  const tileClass =
    variant === 'conversation'
      ? 'group aspect-square w-52 shrink-0 snap-start overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card shadow-sm'
      : variant === 'tool'
        ? 'block h-32 w-40 shrink-0 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm'
        : userMediaTileClass(mediaCount)
  const revealClass = variant === 'user' ? '' : ' ds-media-printer-reveal'
  const mediaClass = `h-full w-full ${variant === 'tool' ? 'object-contain' : 'object-cover'}`
  // Fitted tiles adapt to the image's natural aspect ratio (contain, no crop)
  // once the intrinsic size is known; before that the legacy fixed tile keeps
  // the layout stable.
  const fitConstraints = mediaTileFitConstraints(variant, mediaCount)
  const fittedImageSize = naturalSize ? mediaTileDisplaySize(naturalSize, fitConstraints) : null
  const canSave = !unavailable && Boolean(filePath || dataUrlPayload(previewUrl))
  const canOpenArtifact = !unavailable && Boolean(
    media.artifactId && media.ownerExtensionId && media.ownerExtensionVersion &&
    media.workspaceId && workspaceRoot
  )
  const saveLabel =
    saveState === 'saving'
      ? t('generatedFileSaving')
      : saveState === 'saved'
        ? t('generatedFileSaved')
        : saveState === 'error'
          ? t('generatedFileSaveFailed')
          : t('generatedFileDownload')
  const handleSaveAs = async (): Promise<void> => {
    if (saveState === 'saving' || typeof window.kunGui?.saveWorkspaceFileAs !== 'function') return
    const data = dataUrlPayload(previewUrl)
    if (!filePath && !data) {
      setSaveState('error')
      return
    }
    setSaveState('saving')
    try {
      const result = await window.kunGui.saveWorkspaceFileAs({
        suggestedName: title,
        ...(filePath ? { sourcePath: filePath } : {}),
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(media.mimeType || data?.mimeType ? { mimeType: media.mimeType ?? data?.mimeType } : {}),
        ...(data && !filePath ? { dataBase64: data.dataBase64 } : {})
      })
      if (result.ok) {
        setSaveState('saved')
        window.setTimeout(() => setSaveState('idle'), 1600)
      } else if (result.canceled) {
        setSaveState('idle')
      } else {
        setSaveState('error')
      }
    } catch (error) {
      setSaveState('error')
      void window.kunGui?.logError?.('file-save-as', 'Failed to save generated file', {
        message: error instanceof Error ? error.message : String(error),
        filePath,
        title
      }).catch(() => undefined)
    }
  }
  const handleArtifactAction = async (action: 'open' | 'reveal'): Promise<void> => {
    if (!canOpenArtifact || typeof window.kunGui?.openExtensionArtifact !== 'function') return
    const result = await window.kunGui.openExtensionArtifact({
      artifactId: media.artifactId!,
      ownerExtensionId: media.ownerExtensionId!,
      ownerExtensionVersion: media.ownerExtensionVersion!,
      workspaceId: media.workspaceId!,
      workspaceRoot: workspaceRoot!,
      action
    })
    setSaveState(result.ok ? 'saved' : 'error')
  }
  const saveButtonClass =
    'inline-flex h-7 items-center justify-center rounded-md border border-ds-border-muted bg-ds-card/90 px-2 text-[11.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'
  const iconButtonClass =
    `absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-ds-border-muted bg-ds-card/92 text-ds-muted shadow-sm backdrop-blur transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50 ${
      variant === 'user'
        ? 'h-7 w-7 opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
        : variant === 'conversation'
          ? 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          : ''
    }`
  const saveIcon = saveState === 'saving'
    ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
    : saveState === 'saved'
      ? <Check className="h-3.5 w-3.5" strokeWidth={2} />
      : <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
  const extensionAttachmentContext = {
    'data-extension-attachment-item': '',
    'data-extension-attachment-id': media.id ?? '',
    'data-extension-attachment-mime': media.mimeType ?? ''
  }

  if (previewUrl && mediaIsImage(media)) {
    const fittedFigureClass =
      'group relative block shrink-0 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm'
    const figureClass = fittedImageSize ? fittedFigureClass : tileClass
    const figureStyle = fittedImageSize
      ? { width: `${fittedImageSize.width}px`, height: `${fittedImageSize.height}px` }
      : undefined
    return (
      <figure
        className={`${figureClass}${revealClass} relative`}
        style={figureStyle}
        title={title}
        {...extensionAttachmentContext}
      >
        <button
          type="button"
          onClick={() => setImagePreviewOpen(true)}
          className="block h-full w-full cursor-zoom-in"
          title={t('imagePreviewOpen', { name: title })}
          aria-label={t('imagePreviewOpen', { name: title })}
        >
          <img
            src={previewUrl}
            alt={title}
            className={fittedImageSize ? 'block h-full w-full object-contain' : mediaClass}
            loading="lazy"
            onLoad={(event) => {
              const image = event.currentTarget
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
              }
            }}
          />
        </button>
        {variant === 'user' ? null : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleSaveAs()
            }}
            disabled={!canSave || saveState === 'saving'}
            title={saveLabel}
            aria-label={saveLabel}
            className={iconButtonClass}
          >
            {saveIcon}
          </button>
        )}
        <ImagePreviewLightbox
          open={imagePreviewOpen}
          src={previewUrl}
          alt={title}
          title={title}
          downloadDisabled={!canSave || saveState === 'saving'}
          downloadLabel={saveLabel}
          onDownload={() => void handleSaveAs()}
          onClose={() => setImagePreviewOpen(false)}
        />
      </figure>
    )
  }

  if (previewUrl && mediaIsVideo(media)) {
    return (
      <figure className={`${tileClass} relative`} title={title} {...extensionAttachmentContext}>
        <video src={previewUrl} className={mediaClass} controls preload="metadata" />
        <button
          type="button"
          onClick={() => void handleSaveAs()}
          disabled={!canSave || saveState === 'saving'}
          title={saveLabel}
          aria-label={saveLabel}
          className={iconButtonClass}
        >
          {saveIcon}
        </button>
      </figure>
    )
  }

  const Icon = mediaIsVideo(media) ? Video : mediaIsImage(media) ? ImageIcon : File
  return (
    <div
      className={`${tileClass} flex flex-col justify-between p-3`}
      title={title}
      data-attachment-preview-state={previewState}
      {...extensionAttachmentContext}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-subtle text-ds-muted">
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-[12.5px] font-semibold leading-5 text-ds-ink">
            {title}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-ds-faint">
            {unavailable || previewState === 'failed'
              ? t('generatedFilePreviewUnavailable')
              : previewState === 'loading'
                ? t('filePreviewLoading')
                : [mimeType, byteSize].filter(Boolean).join(' · ') || t('generatedFilePreviewUnavailable')}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleSaveAs()}
          disabled={!canSave || saveState === 'saving'}
          className={saveButtonClass}
          title={saveLabel}
        >
          <span className="mr-1.5">{saveIcon}</span>
          {t('generatedFileDownload')}
        </button>
      {canOpenArtifact ? (
        <>
          <button
            type="button"
            onClick={() => void handleArtifactAction('open')}
            className={saveButtonClass}
          >
            {t('filePreviewOpenEditor')}
          </button>
          <button
            type="button"
            onClick={() => void handleArtifactAction('reveal')}
            className={saveButtonClass}
          >
            {t('fileTreeRevealInFileManager')}
          </button>
        </>
      ) : null}
      {filePath && !unavailable ? (
        <button
          type="button"
          onClick={() => void openWorkspacePathInEditor({ path: filePath }, workspaceRoot)}
          className={saveButtonClass}
        >
          {t('filePreviewOpenEditor')}
        </button>
      ) : null}
      </div>
    </div>
  )
}

export const USER_MEDIA_CAROUSEL_THRESHOLD = 3

export function MediaAttachmentGallery({
  media,
  variant
}: {
  media: TimelineMediaReference[]
  variant: 'user' | 'tool' | 'conversation'
}): ReactElement | null {
  const { t } = useTranslation('common')
  const { ref: previewAdmissionRef, shouldRender: shouldLoadPreviews } = useDeferredRender<HTMLDivElement>({
    enabled: media.length > 0,
    rootMargin: '480px',
    debounceMs: 50,
    idleTimeoutMs: 250
  })
  const { resolvedPreviews, failedPreviewIds } = useMediaPreviews(media, shouldLoadPreviews)
  const conversationScrollerRef = useRef<HTMLDivElement>(null)
  const [scrollAvailability, setScrollAvailability] = useState<GeneratedMediaScrollAvailability>({
    canScrollBackward: false,
    canScrollForward: false
  })
  const useUserCarousel = variant === 'user' && media.length > USER_MEDIA_CAROUSEL_THRESHOLD
  const useCarouselLayout = variant === 'conversation' || useUserCarousel

  useEffect(() => {
    if (!useCarouselLayout) return
    const scroller = conversationScrollerRef.current
    if (!scroller) return

    const updateAvailability = (): void => {
      const next = generatedMediaScrollAvailability(scroller)
      setScrollAvailability((current) =>
        current.canScrollBackward === next.canScrollBackward &&
        current.canScrollForward === next.canScrollForward
          ? current
          : next
      )
    }
    updateAvailability()
    scroller.addEventListener('scroll', updateAvailability, { passive: true })

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateAvailability)
      return () => {
        scroller.removeEventListener('scroll', updateAvailability)
        window.removeEventListener('resize', updateAvailability)
      }
    }

    const resizeObserver = new ResizeObserver(updateAvailability)
    resizeObserver.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', updateAvailability)
      resizeObserver.disconnect()
    }
  }, [media.length, useCarouselLayout])

  if (media.length === 0) return null
  const toolWrapperClass =
    'flex min-w-0 flex-nowrap items-start gap-2 overflow-x-auto border-t border-ds-border-muted/60 px-4 py-3'

  const tiles = media.map((item) => {
    const key = mediaKey(item)
    const resolved = resolvedPreviews[key]
    const resolvedMedia = resolved?.attachment
      ? { ...item, ...resolved.attachment }
      : item
    const previewUrl = item.previewUrl ?? resolved?.previewUrl
    const expectsPreview = Boolean(
      (item.id && !item.artifactId && (mediaIsImage(item) || mediaIsVideo(item) || !item.mimeType)) ||
      (mediaIsImage(item) && mediaPath(item))
    )
    return (
      <MediaPreviewTile
        key={key}
        media={resolvedMedia}
        previewUrl={previewUrl}
        previewState={
          previewUrl
            ? undefined
            : failedPreviewIds[key]
              ? 'failed'
              : expectsPreview
                ? 'loading'
                : undefined
        }
        variant={variant}
        mediaCount={media.length}
      />
    )
  })

  if (variant === 'user' && !useUserCarousel) {
    return (
      <div
        ref={previewAdmissionRef}
        className="relative min-w-0 w-full max-w-[80%]"
        data-extension-attachment-context
        data-user-media-gallery=""
        data-user-media-count={media.length}
      >
        <div className="flex w-full justify-end gap-2 px-0.5 pb-1">
          {tiles}
        </div>
      </div>
    )
  }

  if (variant !== 'tool') {
    const moveCarousel = (direction: -1 | 1): void => {
      const scroller = conversationScrollerRef.current
      if (!scroller) return
      scroller.scrollBy({
        left: direction * Math.max(220, scroller.clientWidth * 0.72),
        behavior: 'smooth'
      })
    }
    const showCarouselControls = scrollAvailability.canScrollBackward || scrollAvailability.canScrollForward
    const isConversation = variant === 'conversation'

    return (
      <div
        ref={previewAdmissionRef}
        className={`group/gallery relative min-w-0 ${isConversation ? 'w-full' : 'w-full max-w-[80%]'}`}
        data-extension-attachment-context
        {...(isConversation
          ? { 'data-generated-media-carousel': true }
          : { 'data-user-media-gallery': '', 'data-user-media-carousel': true, 'data-user-media-count': media.length })}
      >
        <div
          ref={conversationScrollerRef}
          className="flex w-full snap-x snap-mandatory gap-2 overflow-x-auto px-0.5 pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          {...(isConversation ? { 'data-generated-media-strip': true } : {})}
        >
          {tiles}
        </div>
        {showCarouselControls ? (
          isConversation ? (
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => moveCarousel(-1)}
                disabled={!scrollAvailability.canScrollBackward}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/70 disabled:cursor-default disabled:opacity-35"
                title={t('generatedFilesPreviousImages')}
                aria-label={t('generatedFilesPreviousImages')}
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => moveCarousel(1)}
                disabled={!scrollAvailability.canScrollForward}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/70 disabled:cursor-default disabled:opacity-35"
                title={t('generatedFilesNextImages')}
                aria-label={t('generatedFilesNextImages')}
              >
                <ChevronRight className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => moveCarousel(-1)}
                disabled={!scrollAvailability.canScrollBackward}
                className="absolute left-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-ds-border-muted bg-ds-card/92 text-ds-muted opacity-0 shadow-sm backdrop-blur transition hover:bg-ds-hover hover:text-ds-ink focus-visible:opacity-100 disabled:cursor-default disabled:opacity-0 group-hover/gallery:opacity-100"
                title={t('generatedFilesPreviousImages')}
                aria-label={t('generatedFilesPreviousImages')}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => moveCarousel(1)}
                disabled={!scrollAvailability.canScrollForward}
                className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-ds-border-muted bg-ds-card/92 text-ds-muted opacity-0 shadow-sm backdrop-blur transition hover:bg-ds-hover hover:text-ds-ink focus-visible:opacity-100 disabled:cursor-default disabled:opacity-0 group-hover/gallery:opacity-100"
                title={t('generatedFilesNextImages')}
                aria-label={t('generatedFilesNextImages')}
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </>
          )
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={previewAdmissionRef}
      className={toolWrapperClass}
      data-extension-attachment-context
      data-tool-media-gallery=""
      data-tool-media-count={media.length}
    >
      {tiles}
    </div>
  )
}

export function GeneratedFilesPanel({
  blocks,
  placement = 'turn'
}: {
  blocks: ToolBlock[]
  placement?: 'timeline' | 'turn'
}): ReactElement | null {
  const { t } = useTranslation('common')
  const media = useMemo(() => {
    const attachments: AttachmentReference[] = []
    const generatedFiles: GeneratedFileReference[] = []
    for (const block of blocks) {
      attachments.push(...metaAttachmentReferences(block.meta as RuntimeDisclosureMetadata | undefined))
      generatedFiles.push(...metaGeneratedFileReferences(block.meta))
    }
    return mergeMediaReferences(attachments, generatedFiles).filter(
      (file) => !isGeneratedDocumentArtifactPath(mediaPath(file))
    )
  }, [blocks])

  if (media.length === 0) return null

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-generated-files-placement={placement}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ds-faint">
        <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        <span>{t('generatedFilesTitle')}</span>
      </div>
      <MediaAttachmentGallery media={media} variant="conversation" />
    </div>
  )
}

export function UserAttachmentPreviews({
  meta
}: {
  meta?: RuntimeDisclosureMetadata
}): ReactElement | null {
  const attachments = useMemo(() => {
    const attachmentIds = metaStringArray(meta, 'attachmentIds')
    const byId = new Map<string, AttachmentReference>()
    for (const attachment of metaAttachmentReferences(meta)) {
      byId.set(attachment.id, attachment)
    }
    for (const id of attachmentIds) {
      if (!byId.has(id)) byId.set(id, { id })
    }
    return [...byId.values()]
  }, [meta])

  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex min-w-0 justify-end">
      <MediaAttachmentGallery media={attachments} variant="user" />
    </div>
  )
}

export function ToolAttachmentPreviews({
  meta
}: {
  meta?: Record<string, unknown>
}): ReactElement | null {
  const attachments = useMemo(
    () => metaAttachmentReferences(meta as RuntimeDisclosureMetadata | undefined),
    [meta]
  )

  if (attachments.length === 0) return null

  return <MediaAttachmentGallery media={attachments} variant="tool" />
}
