import { memo, useState, type ReactElement } from 'react'
import { FileText, ImagePlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AttachmentReference } from '../../agent/types'
import { ImagePreviewLightbox } from './ImagePreviewLightbox'
import { isOfficeDocumentName } from '@shared/office-document'

type ComposerTransferItem = {
  kind?: string
  type?: string
  getAsFile?: () => File | null
}

export type ComposerImageTransferSource = {
  files?: ArrayLike<File> | null
  items?: ArrayLike<ComposerTransferItem> | null
}

export type ComposerClipboardImageSource = ComposerImageTransferSource & {
  getData?: (format: string) => string
}

export const LONG_PASTE_ATTACHMENT_THRESHOLD_CHARS = 10_000

export function isPastedTextAttachment(attachment: AttachmentReference): boolean {
  return attachment.documentFormat === 'text' && /^pasted-text-.*\.txt$/u.test(attachment.name ?? '')
}

function PastedTextAttachmentCard({
  attachment,
  onRemoveAttachment
}: {
  attachment: AttachmentReference
  onRemoveAttachment?: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const title = attachment.textPreview || attachment.name || attachment.id
  return (
    <span
      className="ds-no-drag relative inline-flex h-20 w-[min(28rem,100%)] items-center gap-3 rounded-[14px] border border-ds-border-muted bg-ds-card px-3 pr-9 shadow-sm"
      title={title}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ds-subtle text-ds-muted">
        <FileText className="h-6 w-6" strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ds-ink">{title}</span>
        <span className="mt-1 block truncate text-[12px] font-medium text-ds-muted">
          {t('composerPastedText')}{attachment.truncated ? ` · ${t('composerAttachmentTruncated')}` : ''}
        </span>
      </span>
      {onRemoveAttachment ? (
        <button
          type="button"
          onClick={() => onRemoveAttachment(attachment.id)}
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
          aria-label={t('composerRemoveAttachment')}
          title={t('composerRemoveAttachment')}
        >
          <X className="h-3 w-3" strokeWidth={2.2} />
        </button>
      ) : null}
    </span>
  )
}

function AttachmentImagePreview({
  attachment,
  onRemoveAttachment
}: {
  attachment: AttachmentReference
  onRemoveAttachment?: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
  const title = attachment.name || attachment.id
  const previewUrl = attachment.previewUrl ?? ''

  return (
    <span
      className="ds-no-drag relative block h-20 w-20 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm"
      title={title}
    >
      <button
        type="button"
        onClick={() => setImagePreviewOpen(true)}
        className="block h-full w-full cursor-zoom-in"
        aria-label={t('imagePreviewOpen', { name: title })}
        title={t('imagePreviewOpen', { name: title })}
      >
        <img
          src={previewUrl}
          alt={title}
          className="h-full w-full bg-ds-subtle object-contain"
        />
      </button>
      {onRemoveAttachment ? (
        <button
          type="button"
          onClick={() => onRemoveAttachment(attachment.id)}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950 text-white shadow-sm transition hover:bg-zinc-800"
          aria-label={t('composerRemoveAttachment')}
          title={t('composerRemoveAttachment')}
        >
          <X className="h-3 w-3" strokeWidth={2.2} />
        </button>
      ) : null}
      <ImagePreviewLightbox
        open={imagePreviewOpen}
        src={previewUrl}
        alt={title}
        title={title}
        downloadHref={previewUrl}
        downloadName={title}
        onClose={() => setImagePreviewOpen(false)}
      />
    </span>
  )
}

export const FloatingComposerAttachments = memo(function FloatingComposerAttachments({
  attachments,
  attachmentUploadError,
  onRemoveAttachment
}: {
  attachments: readonly AttachmentReference[]
  attachmentUploadError?: string | null
  onRemoveAttachment?: (id: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (attachments.length === 0 && !attachmentUploadError) return null

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      {attachments.map((attachment) => (
        isPastedTextAttachment(attachment) ? (
          <PastedTextAttachmentCard
            key={attachment.id}
            attachment={attachment}
            onRemoveAttachment={onRemoveAttachment}
          />
        ) : attachment.previewUrl ? (
          <AttachmentImagePreview
            key={attachment.id}
            attachment={attachment}
            onRemoveAttachment={onRemoveAttachment}
          />
        ) : (
          <span
            key={attachment.id}
            className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card px-2 text-[12px] font-medium text-ds-muted"
            title={attachment.name || attachment.id}
          >
            {attachment.kind === 'document' ? (
              <FileText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
            ) : (
              <ImagePlus className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
            )}
            <span className="max-w-40 truncate">{attachment.name || attachment.id}</span>
            {attachment.kind === 'document' && attachment.pageCount ? (
              <span className="shrink-0 text-[11px] text-ds-faint">
                {attachment.pageCount}p{attachment.truncated ? '+' : ''}
              </span>
            ) : null}
            {onRemoveAttachment ? (
              <button
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
                className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('composerRemoveAttachment')}
                title={t('composerRemoveAttachment')}
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            ) : null}
          </span>
        )
      ))}
      {attachmentUploadError ? (
        <span className="min-w-0 break-words text-[12px] font-medium text-red-600 dark:text-red-300">
          {attachmentUploadError}
        </span>
      ) : null}
    </div>
  )
})

function arrayLikeValues<T>(value: ArrayLike<T> | null | undefined): T[] {
  if (!value) return []
  const out: T[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (item) out.push(item)
  }
  return out
}

export function isComposerImageMimeType(value: string | undefined): boolean {
  return value?.toLowerCase().startsWith('image/') === true
}

export function composerImageMimeTypeFromFileName(name: string | undefined): string | undefined {
  const lower = name?.toLowerCase() ?? ''
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.heic')) return 'image/heic'
  if (lower.endsWith('.heif')) return 'image/heif'
  return undefined
}

export function isComposerPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function isComposerOfficeFile(file: File): boolean {
  return isOfficeDocumentName(file.name)
}

function normalizedImageFile(file: File, mimeTypeHint?: string): File | null {
  const mimeType = isComposerImageMimeType(file.type)
    ? file.type
    : isComposerImageMimeType(mimeTypeHint)
      ? mimeTypeHint
      : composerImageMimeTypeFromFileName(file.name)
  if (!mimeType) return null
  if (file.type === mimeType) return file
  return new File([file], file.name || 'image', {
    type: mimeType,
    lastModified: file.lastModified
  })
}

export function imageFilesFromTransfer(source: ComposerImageTransferSource | null | undefined): File[] {
  if (!source) return []
  const files: File[] = []
  const seen = new Set<File>()
  const addFile = (file: File | null | undefined, mimeTypeHint?: string): void => {
    if (!file || seen.has(file)) return
    seen.add(file)
    const normalized = normalizedImageFile(file, mimeTypeHint)
    if (normalized) files.push(normalized)
  }

  for (const item of arrayLikeValues(source.items)) {
    if (item.kind && item.kind !== 'file') continue
    if (!isComposerImageMimeType(item.type)) continue
    addFile(item.getAsFile?.(), item.type)
  }
  for (const file of arrayLikeValues(source.files)) {
    addFile(file)
  }
  return files
}

export function imageTransferHasImages(source: ComposerImageTransferSource | null | undefined): boolean {
  if (!source) return false
  if (arrayLikeValues(source.files).some((file) => normalizedImageFile(file) !== null)) return true
  return arrayLikeValues(source.items).some((item) =>
    (!item.kind || item.kind === 'file') && isComposerImageMimeType(item.type)
  )
}

export function handleComposerAttachmentPaste({
  canPickAttachment,
  clipboardData,
  preventDefault,
  onPickAttachments,
  onPasteClipboardImage,
  onPasteLongText
}: {
  canPickAttachment: boolean
  clipboardData: ComposerClipboardImageSource
  preventDefault: () => void
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onPasteLongText?: (text: string) => void | Promise<void>
}): boolean {
  if (!canPickAttachment || (!onPickAttachments && !onPasteClipboardImage && !onPasteLongText)) return false
  const files = imageFilesFromTransfer(clipboardData)
  const plainText = clipboardData.getData?.('text/plain') ?? ''
  const hasPlainText = Boolean(plainText)
  const hasImageTransfer = imageTransferHasImages(clipboardData)
  if (files.length > 0) {
    preventDefault()
    if (onPasteClipboardImage) {
      void onPasteClipboardImage({ silentNoImage: false })
      return true
    }
    onPickAttachments?.(files)
    return true
  }
  if (!hasImageTransfer && plainText.length > LONG_PASTE_ATTACHMENT_THRESHOLD_CHARS && onPasteLongText) {
    preventDefault()
    void onPasteLongText(plainText)
    return true
  }
  if (!onPasteClipboardImage) return false

  const shouldPreventDefault = !hasPlainText || hasImageTransfer
  if (shouldPreventDefault) preventDefault()
  void onPasteClipboardImage({ silentNoImage: !shouldPreventDefault })
  return shouldPreventDefault
}

export const handleComposerImagePaste = handleComposerAttachmentPaste
