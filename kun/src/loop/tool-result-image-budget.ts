import { extractToolResultImages } from './tool-result-image.js'
import { DEFAULT_IMAGE_MAX_BASE64_BYTES } from '../adapters/tool/builtin-tool-types.js'

const MAX_INLINE_TOOL_IMAGES = 8

/** Separate bounded vision transport from the independently budgeted text. */
export function prepareToolResultImageBudget(output: unknown): {
  output: unknown
  imageFields?: Record<string, unknown>
} {
  // Vision bytes have a separate, bounded transport budget. Counting base64 as
  // text used to replace ordinary screenshots with text-only artifact envelopes.
  const extracted = extractToolResultImages(output)
  let imageFields: Record<string, unknown> | undefined
  if (extracted.length > 0) {
    let remaining = DEFAULT_IMAGE_MAX_BASE64_BYTES
    const images = extracted.filter((image, index) => {
      const bytes = Buffer.byteLength(image.dataBase64, 'utf8')
      if (index >= MAX_INLINE_TOOL_IMAGES || bytes > remaining ||
        !/^image\/(png|jpeg|gif|webp)$/.test(image.mimeType)) return false
      remaining -= bytes
      return true
    }).map((image) => ({
      mime_type: image.mimeType,
      data_base64: image.dataBase64,
      ...(image.width !== undefined ? { width: image.width } : {}),
      ...(image.height !== undefined ? { height: image.height } : {})
    }))
    const omitted = extracted.length - images.length
    const original = output as Record<string, unknown>
    // Preserve the read tool's public single-image shape. Browser screenshots
    // always use images[] so persistence can redact their transient bytes.
    const singleReadImage = original.kind === 'image' && !Array.isArray(original.images) && images.length === 1
    imageFields = {
      kind: (output as Record<string, unknown>).kind,
      ...(singleReadImage ? images[0] : images.length > 0 ? { images } : {}),
      ...(omitted > 0 ? {
        images_omitted: omitted,
        image_note: 'Image payload omitted: unsupported image type or inline image count/byte limit exceeded. Read a smaller image.'
      } : {})
    }
    // Do not copy image bytes into an artifact preview (or persisted browser
    // metadata). The canonical images array also supports transient redaction.
    output = {
      ...Object.fromEntries(Object.entries(output as Record<string, unknown>)
        .filter(([key]) => key !== 'data_base64' && key !== 'images')),
      ...imageFields
    }
  }
  return { output, ...(imageFields ? { imageFields } : {}) }
}
