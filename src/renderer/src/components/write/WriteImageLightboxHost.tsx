import { useEffect, useState, type ReactElement } from 'react'
import { ImagePreviewLightbox } from '../chat/ImagePreviewLightbox'
import {
  WRITE_IMAGE_LIGHTBOX_EVENT,
  type WriteImageLightboxDetail
} from '../../write/write-image-lightbox'

export function WriteImageLightboxHost({
  workspaceRoot
}: {
  workspaceRoot?: string | null
}): ReactElement | null {
  const [preview, setPreview] = useState<WriteImageLightboxDetail | null>(null)

  useEffect(() => {
    const onPreview = (event: Event): void => {
      const detail = (event as CustomEvent<WriteImageLightboxDetail>).detail
      if (!detail?.src?.trim()) return
      setPreview(detail)
    }
    window.addEventListener(WRITE_IMAGE_LIGHTBOX_EVENT, onPreview)
    return () => window.removeEventListener(WRITE_IMAGE_LIGHTBOX_EVENT, onPreview)
  }, [])

  if (!preview) return null

  return (
    <ImagePreviewLightbox
      open
      src={preview.src}
      alt={preview.alt ?? ''}
      title={preview.title || preview.alt}
      copyPath={preview.localPath}
      copyWorkspaceRoot={workspaceRoot ?? undefined}
      copyDataUrl={preview.src}
      onClose={() => setPreview(null)}
    />
  )
}
