/** Keep draft previews small enough to persist without storing the original image. */
export async function roomComposerImagePreview(file: File): Promise<{ url: string; transient: boolean } | undefined> {
  if (!isRoomComposerImage(file.name, file.type)) return undefined
  if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, 112 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d')
        if (context) {
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          const url = canvas.toDataURL('image/webp', 0.72)
          if (/^data:image\/(?:webp|png|jpeg);base64,/.test(url) && url.length <= 48 * 1024) {
            return { url, transient: false }
          }
        }
      } finally {
        bitmap.close()
      }
    } catch { /* Fall back to a temporary local preview. */ }
  }
  try {
    return { url: URL.createObjectURL(file), transient: true }
  } catch {
    return undefined
  }
}

export function isRoomComposerImage(name: string, mimeType?: string): boolean {
  return Boolean(mimeType?.startsWith('image/')) || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(name)
}
