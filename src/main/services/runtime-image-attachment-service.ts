import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { clipboard } from 'electron'
import sharp from 'sharp'
import { z } from 'zod'
import type { RuntimeRequestResult } from '../../shared/kun-gui-api'
import type {
  RuntimeImageAttachmentMetadata,
  RuntimeImageAttachmentSource,
  RuntimeImageAttachmentTextFallback,
  RuntimeImageAttachmentUploadRequest,
  RuntimeImageAttachmentUploadResult
} from '../../shared/runtime-image-attachment'
import { MAX_RUNTIME_IMAGE_SOURCE_BYTES } from '../ipc/app-ipc-schemas/runtime-image-attachment'

export const MAX_RUNTIME_IMAGE_SOURCE_PIXELS = 100_000_000
export const MAX_RUNTIME_IMAGE_OUTPUT_BYTES = Math.floor(4.5 * 1024 * 1024)

type RuntimeRequest = (
  path: string,
  method?: string,
  body?: string,
  headers?: Record<string, string>
) => Promise<RuntimeRequestResult>

type LoadedImageSource = {
  data: Buffer
  name: string
  localFilePath?: string
}

type AttachmentCapabilities = {
  maxImageBytes: number
  maxImageDimension: number
  allowedMimeTypes: string[]
  textFallbackMaxBase64Bytes: number
  textFallbackMaxImageDimension: number
  textFallbackPreferredMimeType: string
}

type EncodedImage = {
  data: Buffer
  mimeType: string
  width: number
  height: number
  wasCompressed: boolean
}

export type RuntimeImageAttachmentServiceDependencies = {
  runtimeRequest: RuntimeRequest
  readClipboardSource?: () => Promise<LoadedImageSource>
}

const attachmentCapabilitiesSchema = z.object({
  maxImageBytes: z.number().int().positive(),
  maxImageDimension: z.number().int().positive(),
  allowedMimeTypes: z.array(z.string().min(1)).min(1),
  textFallbackMaxBase64Bytes: z.number().int().positive(),
  textFallbackMaxImageDimension: z.number().int().positive(),
  textFallbackPreferredMimeType: z.string().min(1)
})

const runtimeInfoSchema = z.object({
  capabilities: z.object({ attachments: attachmentCapabilitiesSchema })
})

const textFallbackSchema = z.object({
  dataBase64: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  wasCompressed: z.boolean().optional()
})

const attachmentMetadataSchema: z.ZodType<RuntimeImageAttachmentMetadata> = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['image', 'document']).optional(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  hash: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  documentText: z.string().optional(),
  documentFormat: z.enum(['pdf', 'docx', 'xlsx', 'pptx', 'text', 'csv', 'json', 'xml']).optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  pageCount: z.number().int().positive().optional(),
  truncated: z.boolean().optional(),
  localFilePath: z.string().optional(),
  textFallback: textFallbackSchema.optional(),
  visualPreview: textFallbackSchema.optional(),
  threadIds: z.array(z.string()).optional(),
  workspaces: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const attachmentUploadResponseSchema = z.object({ attachment: attachmentMetadataSchema })

export async function uploadRuntimeImageAttachment(
  request: RuntimeImageAttachmentUploadRequest,
  dependencies: RuntimeImageAttachmentServiceDependencies
): Promise<RuntimeImageAttachmentUploadResult> {
  try {
    const [source, capabilities] = await Promise.all([
      loadImageSource(request.source, request.name, dependencies.readClipboardSource),
      loadAttachmentCapabilities(dependencies.runtimeRequest)
    ])
    assertSourceByteLength(source.data.byteLength)
    const prepared = await prepareRuntimeImageAttachment(source.data, capabilities)
    const preview: RuntimeImageAttachmentTextFallback = {
      dataBase64: prepared.fallback.data.toString('base64'),
      mimeType: prepared.fallback.mimeType,
      byteSize: prepared.fallback.data.byteLength,
      width: prepared.fallback.width,
      height: prepared.fallback.height,
      wasCompressed: prepared.fallback.wasCompressed
    }
    const response = await dependencies.runtimeRequest(
      '/v1/attachments',
      'POST',
      JSON.stringify({
        name: request.name?.trim() || source.name,
        mimeType: prepared.upload.mimeType,
        dataBase64: prepared.upload.data.toString('base64'),
        ...(source.localFilePath ? { localFilePath: source.localFilePath } : {}),
        textFallback: preview,
        ...(request.threadId ? { threadId: request.threadId } : {}),
        ...(request.workspace ? { workspace: request.workspace } : {})
      })
    )
    if (!response.ok) throw new Error(runtimeResponseError(response, 'attachment upload failed'))
    const parsed = attachmentUploadResponseSchema.parse(JSON.parse(response.body))
    const { textFallback: _textFallback, ...attachment } = parsed.attachment
    void _textFallback
    return {
      ok: true,
      attachment,
      preview,
      compression: {
        sourceBytes: source.data.byteLength,
        outputBytes: prepared.upload.data.byteLength,
        fallbackBytes: prepared.fallback.data.byteLength,
        wasCompressed: prepared.upload.wasCompressed
      }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function prepareRuntimeImageAttachment(
  source: Buffer,
  capabilities: AttachmentCapabilities
): Promise<{ upload: EncodedImage; fallback: EncodedImage }> {
  assertSourceByteLength(source.byteLength)
  const metadata = await sharp(source, {
    failOn: 'error',
    limitInputPixels: MAX_RUNTIME_IMAGE_SOURCE_PIXELS,
    sequentialRead: true
  }).metadata()
  const dimensions = autoOrientedDimensions(metadata.width, metadata.height, metadata.orientation)
  if (!dimensions.width || !dimensions.height) throw new Error('Image dimensions could not be determined.')
  if (dimensions.width * dimensions.height > MAX_RUNTIME_IMAGE_SOURCE_PIXELS) {
    throw new Error(`Image exceeds the ${MAX_RUNTIME_IMAGE_SOURCE_PIXELS} pixel source limit.`)
  }

  const uploadMaxBytes = Math.min(MAX_RUNTIME_IMAGE_OUTPUT_BYTES, capabilities.maxImageBytes)
  const uploadFormat = selectOutputFormat(capabilities.allowedMimeTypes, metadata.hasAlpha === true)
  const sourceMimeType = sharpFormatMimeType(metadata.format)
  const canKeepOriginal =
    metadata.orientation !== undefined && metadata.orientation !== 1
      ? false
      : Boolean(
          sourceMimeType &&
          capabilities.allowedMimeTypes.includes(sourceMimeType) &&
          source.byteLength <= uploadMaxBytes &&
          Math.max(dimensions.width, dimensions.height) <= capabilities.maxImageDimension
        )
  const upload = canKeepOriginal && sourceMimeType
    ? {
        data: source,
        mimeType: sourceMimeType,
        width: dimensions.width,
        height: dimensions.height,
        wasCompressed: false
      }
    : await encodeWithinLimits(source, {
        format: uploadFormat,
        maxBytes: uploadMaxBytes,
        maxDimension: capabilities.maxImageDimension,
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height
      })

  const fallbackMaxBytes = decodedBytesForBase64Limit(capabilities.textFallbackMaxBase64Bytes)
  const preferredFallback = capabilities.allowedMimeTypes.includes(capabilities.textFallbackPreferredMimeType)
    ? mimeTypeFormat(capabilities.textFallbackPreferredMimeType)
    : undefined
  const fallback = await encodeWithinLimits(source, {
    format: preferredFallback ?? uploadFormat,
    maxBytes: fallbackMaxBytes,
    maxDimension: capabilities.textFallbackMaxImageDimension,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height
  })
  if (Buffer.byteLength(fallback.data.toString('base64'), 'utf8') > capabilities.textFallbackMaxBase64Bytes) {
    throw new Error('Image fallback could not be compressed within the runtime Base64 limit.')
  }
  return { upload, fallback }
}

async function loadAttachmentCapabilities(runtimeRequest: RuntimeRequest): Promise<AttachmentCapabilities> {
  const response = await runtimeRequest('/v1/runtime/info', 'GET')
  if (!response.ok) throw new Error(runtimeResponseError(response, 'failed to load attachment capabilities'))
  return runtimeInfoSchema.parse(JSON.parse(response.body)).capabilities.attachments
}

async function loadImageSource(
  source: RuntimeImageAttachmentSource,
  requestedName: string | undefined,
  readClipboardSource: (() => Promise<LoadedImageSource>) | undefined
): Promise<LoadedImageSource> {
  if (source.kind === 'clipboard') {
    return (readClipboardSource ?? defaultClipboardSource)()
  }
  if (source.kind === 'localPath') {
    const info = await stat(source.path)
    if (!info.isFile()) throw new Error('Image source path is not a file.')
    assertSourceByteLength(info.size)
    return {
      data: await readFile(source.path),
      name: requestedName?.trim() || basename(source.path) || 'image',
      localFilePath: source.path
    }
  }
  const data = decodeBase64(source.dataBase64)
  assertSourceByteLength(data.byteLength)
  return { data, name: requestedName?.trim() || 'image' }
}

async function defaultClipboardSource(): Promise<LoadedImageSource> {
  const image = clipboard.readImage()
  if (image.isEmpty()) throw new Error('Clipboard does not currently contain an image.')
  const data = image.toPNG()
  if (!data.length) throw new Error('Clipboard image could not be encoded as PNG.')
  assertSourceByteLength(data.byteLength)
  const directory = join(tmpdir(), 'kun')
  const localFilePath = join(directory, `clipboard-${Date.now()}-${randomUUID()}.png`)
  await mkdir(directory, { recursive: true })
  await writeFile(localFilePath, data)
  return {
    data,
    name: `pasted-image-${Date.now()}.png`,
    localFilePath
  }
}

async function encodeWithinLimits(
  source: Buffer,
  options: {
    format: 'webp' | 'jpeg' | 'png'
    maxBytes: number
    maxDimension: number
    sourceWidth: number
    sourceHeight: number
  }
): Promise<EncodedImage> {
  const sourceLargest = Math.max(options.sourceWidth, options.sourceHeight)
  let currentMax = Math.max(1, Math.min(options.maxDimension, sourceLargest))
  const qualities = options.format === 'png'
    ? [100, 90, 80, 70, 60, 50, 40]
    : [90, 82, 74, 66, 58, 50, 42, 34]

  for (;;) {
    for (const quality of qualities) {
      let pipeline = sharp(source, {
        failOn: 'error',
        limitInputPixels: MAX_RUNTIME_IMAGE_SOURCE_PIXELS,
        sequentialRead: true
      })
        .rotate()
        .resize({
          width: currentMax,
          height: currentMax,
          fit: 'inside',
          withoutEnlargement: true
        })
      pipeline = options.format === 'webp'
        ? pipeline.webp({ quality, effort: 4 })
        : options.format === 'jpeg'
          ? pipeline.jpeg({ quality, mozjpeg: true })
          : pipeline.png({ compressionLevel: 9, palette: quality < 100, quality })
      const encoded = await pipeline.toBuffer({ resolveWithObject: true })
      if (encoded.data.byteLength <= options.maxBytes) {
        return {
          data: encoded.data,
          mimeType: formatMimeType(options.format),
          width: encoded.info.width,
          height: encoded.info.height,
          wasCompressed: true
        }
      }
    }
    if (currentMax === 1) break
    currentMax = Math.max(1, Math.floor(currentMax * 0.8))
  }
  throw new Error('Image could not be compressed within the runtime attachment limits.')
}

function selectOutputFormat(allowedMimeTypes: string[], hasAlpha: boolean): 'webp' | 'jpeg' | 'png' {
  if (allowedMimeTypes.includes('image/webp')) return 'webp'
  if (hasAlpha && allowedMimeTypes.includes('image/png')) return 'png'
  if (allowedMimeTypes.includes('image/jpeg')) return 'jpeg'
  if (allowedMimeTypes.includes('image/png')) return 'png'
  throw new Error('Runtime does not advertise a supported compressed image MIME type.')
}

function mimeTypeFormat(mimeType: string): 'webp' | 'jpeg' | 'png' | undefined {
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/jpeg') return 'jpeg'
  if (mimeType === 'image/png') return 'png'
  return undefined
}

function formatMimeType(format: 'webp' | 'jpeg' | 'png'): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`
}

function sharpFormatMimeType(format: string | undefined): string | undefined {
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg'
  if (format === 'png' || format === 'webp') return `image/${format}`
  return undefined
}

function autoOrientedDimensions(
  width: number | undefined,
  height: number | undefined,
  orientation: number | undefined
): { width: number; height: number } {
  if (!width || !height) return { width: 0, height: 0 }
  return orientation && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height }
}

function decodedBytesForBase64Limit(maxBase64Bytes: number): number {
  return Math.max(1, Math.floor(maxBase64Bytes / 4) * 3)
}

function decodeBase64(value: string): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Image source is not valid Base64.')
  }
  const data = Buffer.from(value, 'base64')
  const canonical = data.toString('base64')
  if (canonical !== value) throw new Error('Image source is not canonical Base64.')
  return data
}

export function assertSourceByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw new Error('Image source is empty.')
  if (byteLength > MAX_RUNTIME_IMAGE_SOURCE_BYTES) {
    throw new Error(`Image source exceeds the ${MAX_RUNTIME_IMAGE_SOURCE_BYTES} byte limit.`)
  }
}

export function runtimeResponseError(response: RuntimeRequestResult, fallback: string): string {
  try {
    const body = JSON.parse(response.body) as { message?: unknown; error?: unknown }
    if (typeof body.message === 'string' && body.message.trim()) return body.message
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Use the bounded fallback below for non-JSON runtime errors.
  }
  return `${fallback} (HTTP ${response.status})`
}
