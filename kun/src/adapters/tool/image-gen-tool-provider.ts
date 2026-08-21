import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ImageGenerationResolution,
  KunCapabilitiesConfig
} from '../../contracts/capabilities.js'
import { KUN_GENERATED_IMAGE_DIR } from '../../contracts/generated-image-path.js'
import type { AttachmentContent, AttachmentStore } from '../../attachments/attachment-store.js'
import { detectImage } from '../../attachments/attachment-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'
import { LocalToolHost } from './local-tool-host.js'
import { createImageGenClient } from './image-gen-clients.js'
import {
  ImageGenHttpError,
  SIZE_TIERS,
  parseSizeLongEdge
} from './image-gen-client-codecs.js'

export {
  CodexResponsesImageClient,
  GrokImagineImageClient,
  MiniMaxImageClient,
  OpenAiCompatImageClient,
  VolcengineArkImageClient,
  createImageGenClient,
  minimaxImageDimensionFields
} from './image-gen-clients.js'
export {
  ImageGenHttpError,
  codexResponsesImageUrl,
  describeNetworkError,
  openAiCompatImageUrl,
  volcengineArkImageUrl
} from './image-gen-client-codecs.js'

const GENERATED_IMAGE_DIR = KUN_GENERATED_IMAGE_DIR
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
const REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const ASPECT_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'])
const GROK_IMAGINE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '19.5:9',
  '9:19.5',
  '20:9',
  '9:20'
] as const
const KNOWN_ASPECT_RATIOS = new Set([...ASPECT_RATIOS, ...GROK_IMAGINE_ASPECT_RATIOS])
const DEFAULT_IMAGE_SIZE_TIERS = ['1K', '2K'] as const
const VOLCENGINE_IMAGE_SIZE_TIERS = ['2K', '3K', '4K'] as const
const COMPATIBLE_SIZE_FALLBACK = SIZE_TIERS['1K']
const SIZE_STEP = 64
const MIN_EDGE = 256
type ImageGenerationQuality = 'auto' | 'low' | 'medium' | 'high'

export type GeneratedImage = { data: Buffer; mimeType: string }

export type ImageGenRequest = {
  prompt: string
  model: string
  aspectRatio?: string
  size?: string
  quality?: ImageGenerationQuality
  timeoutMs: number
  signal: AbortSignal
}

export type ImageGenEditRequest = ImageGenRequest & {
  images: { name: string; mimeType: string; data: Buffer }[]
}

export interface ImageGenClient {
  id: string
  generate(request: ImageGenRequest): Promise<GeneratedImage>
  edit(request: ImageGenEditRequest): Promise<GeneratedImage>
}

export type ImageGenDiagnostic = {
  id: 'imageGen'
  enabled: boolean
  available: boolean
  model?: string
  reason?: string
}

export type ImageGenToolProviderOptions = {
  client?: ImageGenClient
  attachmentStore?: AttachmentStore
  nowIso?: () => string
  resolveCredential?: ProviderCredentialResolver
}

export type ProviderCredentialResolver = (providerId: string) => Promise<{
  apiKey: string
  headers?: Record<string, string>
  proxyUrl?: string
}>

export type ImageGenToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: ImageGenDiagnostic[]
  available: boolean
}

/**
 * Map UI-friendly aspect ratio + size tier to an OpenAI-compatible "WxH"
 * size string. Long edge anchors to the explicit tier first, then a custom
 * default size, then the configured default resolution. Short edge follows the
 * ratio snapped to multiples of 64 with a 256px floor. `auto` is passed through
 * when no ratio is requested; a ratio needs concrete dimensions, so an `auto`
 * resolution uses a compatible 1K fallback.
 */
export function mapImageSize(
  aspectRatio: string | undefined,
  imageSize: string | undefined,
  defaultSize: string | undefined,
  defaultResolution: ImageGenerationResolution = '1K'
): string | undefined {
  if (imageSize) {
    return sizeForLongEdge(aspectRatio, SIZE_TIERS[imageSize] ?? COMPATIBLE_SIZE_FALLBACK)
  }

  if (defaultSize) {
    if (!aspectRatio) return defaultSize
    const longEdge = parseSizeLongEdge(defaultSize)
    if (longEdge) return sizeForLongEdge(aspectRatio, longEdge)
  }

  if (!aspectRatio && defaultResolution === 'auto') return 'auto'
  return sizeForLongEdge(
    aspectRatio,
    SIZE_TIERS[defaultResolution] ?? COMPATIBLE_SIZE_FALLBACK
  )
}

function sizeForLongEdge(aspectRatio: string | undefined, longEdge: number): string {
  const parsed = parseRatio(aspectRatio)
  if (!parsed) return `${longEdge}x${longEdge}`
  const { w, h } = parsed
  if (w === h) return `${longEdge}x${longEdge}`
  const short = Math.max(
    MIN_EDGE,
    Math.round((longEdge * Math.min(w, h)) / Math.max(w, h) / SIZE_STEP) * SIZE_STEP
  )
  return w > h ? `${longEdge}x${short}` : `${short}x${longEdge}`
}

function parseRatio(aspectRatio: string | undefined): { w: number; h: number } | null {
  if (!aspectRatio || !KNOWN_ASPECT_RATIOS.has(aspectRatio)) return null
  const [w, h] = aspectRatio.split(':').map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

/**
 * Whether the configured image protocol performs a GENUINE image-to-image edit
 * (real `/images/edits`). Allowlist on purpose: a new protocol defaults to "no
 * edit" until its edit path is verified. Codex's Responses image_generation
 * path accepts `input_image` references and an explicit `action: "edit"`.
 * MiniMax's reference feature is `subject_reference` = character/identity
 * preservation, NOT a general edit, so routing canvas "edit this image"
 * requests through it silently produces a fresh (wrong) generation — better to
 * fail loudly and have the agent retry without references. `undefined` = the
 * default factory path (OpenAI-compat /images/edits).
 */
export function protocolSupportsImageEdit(protocol: string | undefined): boolean {
  return protocol === undefined ||
    protocol === 'openai-images' ||
    protocol === 'codex-responses-image' ||
    protocol === 'volcengine-ark-image'
}

export function buildImageGenToolProviders(
  config: KunCapabilitiesConfig['imageGen'] | undefined,
  options: ImageGenToolProviderOptions = {}
): ImageGenToolProviderBuildResult {
  if (!config?.enabled) {
    return { providers: [], diagnostics: [], available: false }
  }

  const missing = [
    !config.baseUrl ? 'baseUrl' : undefined,
    !config.apiKey && !(config.providerId && options.resolveCredential) ? 'apiKey' : undefined,
    !config.model ? 'model' : undefined
  ].filter((field): field is string => Boolean(field))

  if (missing.length > 0) {
    const reason = `image generation provider is not configured (missing ${missing.join(', ')})`
    return {
      providers: [{ id: 'imageGen', kind: 'image', enabled: true, available: false, reason, tools: [] }],
      diagnostics: [{ id: 'imageGen', enabled: true, available: false, model: config.model, reason }],
      available: false
    }
  }

  const model = config.model!
  // Only advertise (and accept) image-to-image when the active protocol can truly
  // edit; otherwise the param is dropped so the model never tries a reference edit
  // the provider would silently mishandle.
  const supportsEdit = protocolSupportsImageEdit(config.protocol)
  const isGrokImagine = config.protocol === 'grok-imagine-image'
  const isVolcengineArk = config.protocol === 'volcengine-ark-image'
  const imageSizeTiers = isVolcengineArk
    ? VOLCENGINE_IMAGE_SIZE_TIERS
    : DEFAULT_IMAGE_SIZE_TIERS
  const imageSizeTierDescription = isVolcengineArk
    ? '2K, 3K, or 4K'
    : '1K or 2K'
  const effectiveDefaultResolution: ImageGenerationResolution = isVolcengineArk
    ? config.defaultResolution === '3K' || config.defaultResolution === '4K'
      ? config.defaultResolution
      : '2K'
    : config.defaultResolution === 'auto' ||
        config.defaultResolution === '1K' ||
        config.defaultResolution === '2K'
      ? config.defaultResolution
      : '1K'

  const tool = LocalToolHost.defineTool({
    name: 'generate_image',
    toolKind: 'file_change',
    description: [
      'Generate an image from a text prompt using the configured image provider.',
      supportsEdit
        ? 'Optionally pass reference_image_paths (workspace files) and/or reference_attachment_ids (authorized image attachments from the current thread) to guide the result (image-to-image).'
        : '',
      `The generated image is saved under ${GENERATED_IMAGE_DIR}/ in the workspace and returned as an inline attachment preview.`,
      'Generates exactly one image per call; call again for variations.',
      'Image quality is applied automatically from Settings and is independent of resolution.',
      'If you can see images, the generated result is shown back to you — inspect it and call again to refine if it does not match what was asked.'
    ].filter(Boolean).join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed description of the image to generate' },
        aspect_ratio: {
          type: 'string',
          enum: isGrokImagine ? [...GROK_IMAGINE_ASPECT_RATIOS] : [...ASPECT_RATIOS],
          description: 'Optional output aspect ratio. It changes proportions while preserving the selected or default resolution.'
        },
        image_size: {
          type: 'string',
          enum: [...imageSizeTiers],
          description: `Optional resolution override. Set it only when the user explicitly requests ${imageSizeTierDescription}; otherwise omit it so the Settings default resolution is used. Resolution is independent of image quality.`
        },
        ...(supportsEdit
          ? {
              reference_image_paths: {
                type: 'array',
                items: { type: 'string' },
                maxItems: config.maxReferenceImages,
                description: 'Workspace-relative paths of reference images for image-to-image guidance'
              },
              reference_attachment_ids: {
                type: 'array',
                items: { type: 'string' },
                maxItems: config.maxReferenceImages,
                description: 'Authorized image attachment IDs from the current thread or workspace for image-to-image guidance'
              }
            }
          : {})
      },
      required: ['prompt'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const prompt = pickString(args.prompt)
      if (!prompt) return toolError('invalid_prompt', 'prompt is required')

      const aspectRatio = pickString(args.aspect_ratio)
      const imageSize = pickString(args.image_size)
      const size = mapImageSize(
        aspectRatio,
        imageSize,
        isGrokImagine ? undefined : config.defaultSize,
        effectiveDefaultResolution
      )

      const references = await collectReferenceImages(
        args.reference_image_paths,
        args.reference_attachment_ids,
        context,
        config.maxReferenceImages,
        options.attachmentStore
      )
      if ('error' in references) return references.error

      const endpoint = references.images.length > 0 ? 'edits' : 'generations'
      // Fail loudly BEFORE any network call when the active provider can't truly
      // edit (e.g. MiniMax, whose subject_reference is identity preservation, not
      // a general edit) — a silently-wrong fresh generation is worse than an error
      // the agent recovers from by retrying without references.
      if (endpoint === 'edits' && !supportsEdit) {
        return toolError(
          'edits_unsupported',
          'the active image provider does not support editing an existing image (its reference feature is subject/identity guidance, not a faithful edit); retry generate_image WITHOUT reference_image_paths'
        )
      }
      let image: GeneratedImage
      let client = options.client
      const requestTelemetry = () => telemetry(startedAt, client?.id ?? 'image-provider')
      try {
        if (!client) {
          const credential = config.providerId && options.resolveCredential
            ? await options.resolveCredential(config.providerId)
            : undefined
          client = createImageGenClient({
            ...config,
            ...(credential ? {
              apiKey: credential.apiKey,
              headers: { ...(config.headers ?? {}), ...(credential.headers ?? {}) },
              ...(credential.proxyUrl ? { proxyUrl: credential.proxyUrl } : {})
            } : {})
          })
        }
        const request = {
          prompt,
          model,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(size && size !== 'auto' ? { size } : {}),
          quality: config.quality,
          timeoutMs: config.timeoutMs,
          signal: context.abortSignal
        }
        image = endpoint === 'edits'
          ? await client.edit({ ...request, images: references.images })
          : await client.generate(request)
      } catch (error) {
        if (error instanceof ImageGenHttpError) {
          if (endpoint === 'edits' && (error.status === 404 || error.status === 405 || error.status === 501)) {
            return toolError(
              'edits_unsupported',
              'the configured image provider does not support reference image edits; retry generate_image without reference_image_paths'
            )
          }
          return toolError('provider_error', error.message, requestTelemetry())
        }
        return toolError('generation_failed', errorMessage(error), requestTelemetry())
      }

      const detected = detectImage(image.data)
      const mimeType = detected?.mimeType ?? image.mimeType ?? 'image/png'
      const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
      const stamp = (options.nowIso?.() ?? new Date().toISOString()).replace(/\D/g, '').slice(0, 14)
      const fileName = `img-${stamp}-${randomBytes(2).toString('hex')}.${ext}`
      // Forward slashes regardless of platform: the path is echoed back to the
      // model and rendered in chat, where POSIX-style relative paths are expected.
      const relativePath = `${GENERATED_IMAGE_DIR}/${fileName}`
      let absolutePath: string
      try {
        const target = await resolveWorkspacePath(relativePath, context, { enforceWorkspaceBoundary: true })
        await mkdir(dirname(target.absolutePath), { recursive: true })
        // Re-check after directory creation: an existing generated-dir symlink
        // is the common escape path, and a racing replacement must not turn an
        // otherwise lexical in-workspace path into an outside write.
        absolutePath = (await resolveWorkspacePath(relativePath, context, {
          enforceWorkspaceBoundary: true
        })).absolutePath
        await writeFile(absolutePath, image.data)
      } catch (error) {
        return toolError('workspace_path_escape', errorMessage(error), requestTelemetry())
      }

      const warnings: string[] = []
      const attachments: { id: string; name: string; mimeType: string; width?: number; height?: number }[] = []
      if (options.attachmentStore) {
        try {
          const attachment = await options.attachmentStore.create({
            name: fileName,
            data: image.data,
            mimeType,
            threadId: context.threadId,
            workspace: context.workspace
          })
          attachments.push({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            ...(attachment.width ? { width: attachment.width } : {}),
            ...(attachment.height ? { height: attachment.height } : {})
          })
        } catch (error) {
          warnings.push(`inline preview unavailable: ${errorMessage(error)}`)
        }
      } else {
        warnings.push('inline preview unavailable: attachment store is disabled')
      }

      return {
        output: {
          files: [{
            relativePath,
            absolutePath,
            mimeType,
            byteSize: image.data.byteLength,
            ...(detected?.width ? { width: detected.width } : {}),
            ...(detected?.height ? { height: detected.height } : {})
          }],
          attachments,
          model,
          ...(size ? { size } : {}),
          quality: config.quality,
          endpoint,
          mode: endpoint === 'edits' ? 'edit' : 'generation',
          referenceImageCount: references.images.length,
          warnings,
          telemetry: requestTelemetry()
        }
      }
    }
  })

  return {
    providers: [{ id: 'imageGen', kind: 'image', enabled: true, available: true, tools: [tool] }],
    diagnostics: [{ id: 'imageGen', enabled: true, available: true, model }],
    available: true
  }
}

type ReferenceImages = { images: { name: string; mimeType: string; data: Buffer }[] }
type ReferenceError = { error: { output: unknown; isError: true } }

async function collectReferenceImages(
  pathValue: unknown,
  attachmentIdValue: unknown,
  context: ToolHostContext,
  maxCount: number,
  attachmentStore: AttachmentStore | undefined
): Promise<ReferenceImages | ReferenceError> {
  const paths = parseReferenceStrings(pathValue, 'reference_image_paths', 'invalid_reference_path')
  if ('error' in paths) return paths
  const attachmentIds = parseReferenceStrings(
    attachmentIdValue,
    'reference_attachment_ids',
    'invalid_reference_attachment'
  )
  if ('error' in attachmentIds) return attachmentIds
  if (paths.values.length + attachmentIds.values.length > maxCount) {
    return {
      error: toolError(
        'invalid_reference_count',
        `at most ${maxCount} reference images are allowed across reference_image_paths and reference_attachment_ids`
      )
    }
  }

  const images: ReferenceImages['images'] = []
  for (const rawPath of paths.values) {
    let resolved: string
    try {
      resolved = (await resolveWorkspacePath(rawPath, context, { enforceWorkspaceBoundary: true })).absolutePath
    } catch {
      return { error: toolError('invalid_reference_path', `reference image must be inside the workspace: ${rawPath}`) }
    }
    let data: Buffer
    try {
      data = await readFile(resolved)
    } catch {
      return { error: toolError('invalid_reference_path', `reference image not found: ${rawPath}`) }
    }
    const validated = validateReferenceImage(data, rawPath, 'invalid_reference_path')
    if ('error' in validated) return validated
    images.push({
      name: rawPath.split(/[\\/]/).pop() || 'reference.png',
      mimeType: validated.mimeType,
      data
    })
  }

  if (attachmentIds.values.length > 0 && !attachmentStore) {
    return {
      error: toolError(
        'invalid_reference_attachment',
        'reference attachments are unavailable because the attachment store is disabled'
      )
    }
  }
  for (const id of attachmentIds.values) {
    let attachment: AttachmentContent
    try {
      attachment = await attachmentStore!.resolveContent(id, {
        threadId: context.threadId,
        workspace: context.workspace
      })
    } catch {
      return {
        error: toolError(
          'invalid_reference_attachment',
          `reference attachment is unavailable or unauthorized: ${id}`
        )
      }
    }
    const validated = validateReferenceImage(
      attachment.data,
      id,
      'invalid_reference_attachment'
    )
    if ('error' in validated) return validated
    images.push({ name: attachment.name, mimeType: validated.mimeType, data: attachment.data })
  }
  return { images }
}

type ReferenceErrorCode = 'invalid_reference_path' | 'invalid_reference_attachment'

function parseReferenceStrings(
  value: unknown,
  field: string,
  code: ReferenceErrorCode
): { values: string[] } | ReferenceError {
  if (value === undefined || value === null) return { values: [] }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return { error: toolError(code, `${field} must be an array of strings`) }
  }
  return { values: value.map((entry) => entry.trim()).filter(Boolean) }
}

function validateReferenceImage(
  data: Buffer,
  label: string,
  code: ReferenceErrorCode
): { mimeType: string } | ReferenceError {
  if (data.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    return {
      error: toolError(code, `reference image exceeds ${MAX_REFERENCE_IMAGE_BYTES} byte limit: ${label}`)
    }
  }
  const detected = detectImage(data)
  if (!detected || !REFERENCE_MIME_TYPES.has(detected.mimeType)) {
    return {
      error: toolError(code, `reference image must be png, jpeg, or webp: ${label}`)
    }
  }
  return { mimeType: detected.mimeType }
}


function telemetry(startedAt: number, provider: string): Record<string, unknown> {
  return { provider, durationMs: Date.now() - startedAt }
}

function toolError(code: string, message: string, toolTelemetry?: Record<string, unknown>): { output: unknown; isError: true } {
  return {
    output: {
      error: { code, message },
      ...(toolTelemetry ? { telemetry: toolTelemetry } : {})
    },
    isError: true
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
