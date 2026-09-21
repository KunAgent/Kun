export const WRITE_IMAGE_LIGHTBOX_EVENT = 'kun:write-image-lightbox'

export type WriteImageLightboxDetail = {
  src: string
  alt?: string
  title?: string
  localPath?: string
}

export function openWriteImageLightbox(detail: WriteImageLightboxDetail): void {
  const src = detail.src.trim()
  if (!src || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<WriteImageLightboxDetail>(WRITE_IMAGE_LIGHTBOX_EVENT, {
    detail: {
      src,
      ...(detail.alt ? { alt: detail.alt } : {}),
      ...(detail.title ? { title: detail.title } : {}),
      ...(detail.localPath?.trim() ? { localPath: detail.localPath.trim() } : {})
    }
  }))
}
