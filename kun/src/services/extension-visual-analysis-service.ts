import { createHash, randomUUID, verify } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MediaAnalyzeVisualFramesRequestSchema,
  MediaAnalyzeVisualFramesResultSchema,
  MediaEmbedVisualQueryRequestSchema,
  MediaEmbedVisualQueryResultSchema,
  MediaVisualModelInstallReceiptSchema,
  MediaVisualModelStatusSchema,
  type MediaAnalyzeVisualFramesRequest,
  type MediaAnalyzeVisualFramesResult,
  type MediaEmbedVisualQueryRequest,
  type MediaEmbedVisualQueryResult,
  type MediaVisualAdapterBinding,
  type MediaVisualModelDescriptor,
  type MediaVisualModelInstallReceipt,
  type MediaVisualModelStatus
} from '@kun/extension-api'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionMediaProcessError,
  ExtensionMediaProcessService,
  VISUAL_FEATURE_DIMENSIONS
} from './extension-media-process-service.js'

const MODEL_PAYLOAD = '{"schemaVersion":1,"packageId":"kun-bundled.visual-features-v1","modelId":"kun-visual-features","modelVersion":"1.0.0","embeddingDimensions":24,"algorithm":"kun.rgb-edge-features","algorithmVersion":"1.0.0","querySemantics":"bounded-visual-features-v1","features":["mean-red","mean-green","mean-blue","brightness","darkness","saturation","low-saturation","contrast","low-contrast","edge-density","smoothness","warmth","coolness","red-dominance","green-dominance","blue-dominance","near-black","dark","midtone","bright","highlight","horizontal-edge","vertical-edge","neutral-bias"]}\n'
const MODEL_FILE_NAME = 'visual-features-v1.json'
const MODEL_FILE_SHA256 = '969024f5de7e8f8013f7ada5e08d53c209d221a0b313bd8b35862ce57387351a'
const MODEL_FILE_BYTES = 582
const MODEL_MANIFEST = '{"schemaVersion":1,"packageId":"kun-bundled.visual-features-v1","modelId":"kun-visual-features","modelVersion":"1.0.0","adapterId":"kun.local.visual-features","adapterVersion":"1.0.0","embeddingDimensions":24,"querySemantics":"bounded-visual-features-v1","files":[{"name":"visual-features-v1.json","sha256":"969024f5de7e8f8013f7ada5e08d53c209d221a0b313bd8b35862ce57387351a","byteSize":582}]}\n'
const MODEL_MANIFEST_SHA256 = 'f4d848a8b7d604ad79c7249cf8fdd3f3ef76d8cfd3fe2d9d57c51dcd1a180763'
const MODEL_MANIFEST_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAVWBgQMG1ffPS0BDDjYVuXIIXDsRfY0UqklfSub/uC90=\n-----END PUBLIC KEY-----\n'
const MODEL_MANIFEST_SIGNATURE = 'b9PdLNHTv2/dfJniyNtXj5YmZVHg0GePd2OF+8unjPlvSBQEYPdbRvAX/d019aAdAb03BAklGhf/MAR9Y1WeCw=='

export const KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR: MediaVisualModelDescriptor = {
  adapterId: 'kun.local.visual-features',
  adapterVersion: '1.0.0',
  modelId: 'kun-visual-features',
  modelVersion: '1.0.0',
  packageId: 'kun-bundled.visual-features-v1',
  manifestSha256: MODEL_MANIFEST_SHA256,
  files: [{ name: MODEL_FILE_NAME, sha256: MODEL_FILE_SHA256, byteSize: MODEL_FILE_BYTES }],
  embeddingDimensions: VISUAL_FEATURE_DIMENSIONS,
  execution: 'local',
  querySemantics: 'bounded-visual-features-v1'
}

type ExtensionVisualAnalysisServiceOptions = {
  dataDir: string
  media: ExtensionMediaProcessService
  now?: () => Date
}

type InstalledState = {
  receipt?: MediaVisualModelInstallReceipt
  invalid: boolean
}

/**
 * Generic Kun-owned local visual adapter. The installed package is a small,
 * signed, bundled algorithm manifest—not hidden model weights and not a fake
 * neural embedding. It measures real decoded RGB/luma/edge features and only
 * supports the documented bounded query vocabulary.
 */
export class ExtensionVisualAnalysisService {
  private readonly modelRoot: string
  private readonly now: () => Date
  private installPromise?: Promise<MediaVisualModelStatus>

  constructor(private readonly options: ExtensionVisualAnalysisServiceOptions) {
    this.modelRoot = join(options.dataDir, 'extensions', 'models', 'visual-features-v1')
    this.now = options.now ?? (() => new Date())
  }

  async status(principal: ExtensionPrincipal): Promise<MediaVisualModelStatus> {
    // Reuse the media permission gate without exposing executable paths.
    await this.options.media.capabilities(principal)
    const checkedAt = this.now().toISOString()
    const installed = await this.readInstalledState()
    if (installed.receipt) {
      return MediaVisualModelStatusSchema.parse({
        schemaVersion: 1,
        state: 'installed',
        descriptor: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR,
        receipt: installed.receipt,
        installSupported: true,
        checkedAt,
        remediation: 'Verified bundled local visual features are installed. Inference decodes authorized media locally and performs no network requests.',
        local: true,
        networkUsedForInference: false,
        rawPathsExposed: false,
        urlsAccepted: false
      })
    }
    return MediaVisualModelStatusSchema.parse({
      schemaVersion: 1,
      state: installed.invalid ? 'failed' : 'missing',
      descriptor: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR,
      installSupported: true,
      checkedAt,
      remediation: installed.invalid
        ? 'The bundled visual feature package failed digest, signature, or receipt verification. Reinstall it through Kun before indexing.'
        : 'Install Kun\'s signed bundled visual feature package. This copies only verified local bytes and does not download or upload media.',
      local: true,
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false
    })
  }

  async install(principal: ExtensionPrincipal): Promise<MediaVisualModelStatus> {
    await this.options.media.capabilities(principal)
    this.installPromise ??= this.installOnce(principal).finally(() => {
      this.installPromise = undefined
    })
    return await this.installPromise
  }

  async analyzeFrames(
    principal: ExtensionPrincipal,
    rawRequest: MediaAnalyzeVisualFramesRequest,
    signal?: AbortSignal
  ): Promise<MediaAnalyzeVisualFramesResult> {
    const request = MediaAnalyzeVisualFramesRequestSchema.parse(rawRequest)
    signal?.throwIfAborted()
    const readiness = await this.readyFor(request.adapter, principal)
    if (readiness) return readiness
    try {
      const measured = await this.options.media.analyzeVisualFramesForCore(
        principal,
        request.inputHandleId,
        request.samples,
        { signal }
      )
      return MediaAnalyzeVisualFramesResultSchema.parse({
        outcome: 'ready',
        source: measured.source,
        adapter: request.adapter,
        embeddings: measured.embeddings,
        provenance: {
          algorithm: 'kun.rgb-edge-features',
          algorithmVersion: '1.0.0',
          decodedFrameWidth: measured.decodedFrameWidth,
          decodedFrameHeight: measured.decodedFrameHeight,
          local: true,
          networkUsed: false
        }
      })
    } catch (error) {
      return visualProcessUnavailable(error)
    }
  }

  async embedQuery(
    principal: ExtensionPrincipal,
    rawRequest: MediaEmbedVisualQueryRequest,
    signal?: AbortSignal
  ): Promise<MediaEmbedVisualQueryResult> {
    const request = MediaEmbedVisualQueryRequestSchema.parse(rawRequest)
    signal?.throwIfAborted()
    const readiness = await this.readyFor(request.adapter, principal)
    if (readiness) return readiness
    const embedded = boundedVisualQueryFeatures(request.query)
    if (!embedded) {
      return visualUnavailable(
        'VISUAL_QUERY_UNSUPPORTED',
        'This honest local adapter only searches measured color, brightness, saturation, contrast, warmth, and edge/detail concepts. Use filename or transcript search for people, objects, actions, or arbitrary prose.',
        false
      )
    }
    return MediaEmbedVisualQueryResultSchema.parse({
      outcome: 'ready',
      adapter: request.adapter,
      vector: embedded.vector,
      matchedConcepts: embedded.matchedConcepts,
      scoreSemantics: 'uncalibrated-cosine',
      local: true,
      networkUsed: false
    })
  }

  private async installOnce(principal: ExtensionPrincipal): Promise<MediaVisualModelStatus> {
    const existing = await this.status(principal)
    if (existing.state === 'installed') return existing
    if (!verifyBundledManifest()) {
      throw new Error('Bundled visual model signature or manifest digest is invalid')
    }
    const installedAt = this.now().toISOString()
    const receipt = MediaVisualModelInstallReceiptSchema.parse({
      broker: 'kun-model-broker',
      packageSource: 'bundled',
      packageId: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.packageId,
      modelId: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.modelId,
      modelVersion: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.modelVersion,
      manifestSha256: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.manifestSha256,
      files: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.files,
      downloadVerified: false,
      sourceVerified: true,
      installVerified: true,
      signatureVerified: true,
      installedAt
    })
    const parent = join(this.options.dataDir, 'extensions', 'models')
    const staging = join(parent, `.visual-features-v1-${randomUUID()}.staging`)
    await mkdir(staging, { recursive: true, mode: 0o700 })
    try {
      await Promise.all([
        writeFile(join(staging, MODEL_FILE_NAME), MODEL_PAYLOAD, { encoding: 'utf8', mode: 0o600 }),
        writeFile(join(staging, 'manifest.json'), MODEL_MANIFEST, { encoding: 'utf8', mode: 0o600 }),
        writeFile(join(staging, 'manifest.signature'), MODEL_MANIFEST_SIGNATURE, { encoding: 'utf8', mode: 0o600 }),
        writeFile(join(staging, 'receipt.json'), `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 })
      ])
      if (!(await this.verifyDirectory(staging)).receipt) {
        throw new Error('Staged bundled visual model failed verification')
      }
      await rm(this.modelRoot, { recursive: true, force: true })
      await rename(staging, this.modelRoot)
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
    return await this.status(principal)
  }

  private async readyFor(
    adapter: MediaVisualAdapterBinding,
    principal: ExtensionPrincipal
  ): Promise<Extract<MediaAnalyzeVisualFramesResult, { outcome: 'unavailable' }> | undefined> {
    if (!sameAdapter(adapter, KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR)) {
      return visualUnavailable(
        'VISUAL_MODEL_MISMATCH',
        'The requested adapter identity does not match Kun\'s verified local visual package. Refresh capability state and rebuild the immutable index.',
        false
      )
    }
    const status = await this.status(principal)
    if (status.state !== 'installed') {
      return visualUnavailable(
        status.state === 'failed' ? 'VISUAL_MODEL_UNVERIFIED' : 'VISUAL_MODEL_MISSING',
        status.remediation,
        true
      )
    }
    return undefined
  }

  private async readInstalledState(): Promise<InstalledState> {
    try {
      await stat(this.modelRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { invalid: false }
      return { invalid: true }
    }
    return await this.verifyDirectory(this.modelRoot)
  }

  private async verifyDirectory(path: string): Promise<InstalledState> {
    try {
      const [payload, manifest, signature, receiptText] = await Promise.all([
        readFile(join(path, MODEL_FILE_NAME)),
        readFile(join(path, 'manifest.json')),
        readFile(join(path, 'manifest.signature'), 'utf8'),
        readFile(join(path, 'receipt.json'), 'utf8')
      ])
      if (
        payload.byteLength !== MODEL_FILE_BYTES ||
        sha256(payload) !== MODEL_FILE_SHA256 ||
        manifest.toString('utf8') !== MODEL_MANIFEST ||
        sha256(manifest) !== MODEL_MANIFEST_SHA256 ||
        signature.trim() !== MODEL_MANIFEST_SIGNATURE ||
        !verify(null, manifest, MODEL_MANIFEST_PUBLIC_KEY, Buffer.from(signature.trim(), 'base64'))
      ) return { invalid: true }
      const receipt = MediaVisualModelInstallReceiptSchema.parse(JSON.parse(receiptText))
      if (!receiptMatchesDescriptor(receipt, KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR)) return { invalid: true }
      return { receipt, invalid: false }
    } catch {
      return { invalid: true }
    }
  }
}

function verifyBundledManifest(): boolean {
  return sha256(Buffer.from(MODEL_PAYLOAD)) === MODEL_FILE_SHA256 &&
    Buffer.byteLength(MODEL_PAYLOAD) === MODEL_FILE_BYTES &&
    sha256(Buffer.from(MODEL_MANIFEST)) === MODEL_MANIFEST_SHA256 &&
    verify(
      null,
      Buffer.from(MODEL_MANIFEST),
      MODEL_MANIFEST_PUBLIC_KEY,
      Buffer.from(MODEL_MANIFEST_SIGNATURE, 'base64')
    )
}

function receiptMatchesDescriptor(
  receipt: MediaVisualModelInstallReceipt,
  descriptor: MediaVisualModelDescriptor
): boolean {
  return receipt.broker === 'kun-model-broker' &&
    receipt.packageSource === 'bundled' &&
    receipt.downloadVerified === false &&
    receipt.sourceVerified === true &&
    receipt.installVerified === true &&
    receipt.signatureVerified === true &&
    receipt.packageId === descriptor.packageId &&
    receipt.modelId === descriptor.modelId &&
    receipt.modelVersion === descriptor.modelVersion &&
    receipt.manifestSha256 === descriptor.manifestSha256 &&
    JSON.stringify(receipt.files) === JSON.stringify(descriptor.files)
}

function sameAdapter(
  adapter: MediaVisualAdapterBinding,
  descriptor: MediaVisualModelDescriptor
): boolean {
  return adapter.id === descriptor.adapterId &&
    adapter.version === descriptor.adapterVersion &&
    adapter.modelId === descriptor.modelId &&
    adapter.modelVersion === descriptor.modelVersion &&
    adapter.packageId === descriptor.packageId &&
    adapter.manifestSha256 === descriptor.manifestSha256 &&
    adapter.embeddingDimensions === descriptor.embeddingDimensions &&
    adapter.execution === 'local'
}

function visualProcessUnavailable(error: unknown): MediaAnalyzeVisualFramesResult {
  if (!(error instanceof ExtensionMediaProcessError)) throw error
  if (error.code === 'process_cancelled') throw error
  if (error.code === 'permission_denied') throw error
  return visualUnavailable(
    error.code === 'executable_unavailable'
      ? 'VISUAL_EXECUTABLE_UNAVAILABLE'
      : 'VISUAL_MEDIA_UNSUPPORTED',
    error.code === 'executable_unavailable'
      ? 'Install FFmpeg and FFprobe in a reviewed Kun Host location, then retry local visual indexing.'
      : 'Kun could not decode the requested authorized visual frame with its fixed local profile. Reauthorize a supported video/image source or use filename/transcript search.',
    error.retryable
  )
}

function visualUnavailable(
  code: Extract<MediaAnalyzeVisualFramesResult, { outcome: 'unavailable' }>['code'],
  remediation: string,
  retryable: boolean
): Extract<MediaAnalyzeVisualFramesResult, { outcome: 'unavailable' }> {
  return {
    outcome: 'unavailable',
    code,
    remediation,
    retryable,
    local: true,
    networkUsed: false
  }
}

type QueryEmbedding = { vector: number[]; matchedConcepts: string[] }

export function boundedVisualQueryFeatures(query: string): QueryEmbedding | undefined {
  const text = query.normalize('NFKC').toLocaleLowerCase('en-US')
  const vector = new Array<number>(VISUAL_FEATURE_DIMENSIONS).fill(0)
  const matched = new Set<string>()
  const add = (concept: string, indexes: Array<[number, number]>): void => {
    matched.add(concept)
    for (const [index, weight] of indexes) vector[index]! += weight
  }
  const includes = (...terms: string[]): boolean => terms.some((term) => containsBoundedTerm(text, term))
  if (includes('red', '红')) add('red', [[0, 1], [13, 1], [11, 0.35]])
  if (includes('green', '绿')) add('green', [[1, 1], [14, 1]])
  if (includes('blue', '蓝')) add('blue', [[2, 1], [15, 1], [12, 0.35]])
  if (includes('bright', 'light scene', '明亮', '亮场', '白天')) add('bright', [[3, 1], [19, 0.8], [20, 0.8]])
  if (includes('dark', 'night', 'low light', '暗', '夜晚', '黑场')) add('dark', [[4, 1], [16, 0.8], [17, 0.8]])
  if (includes('colorful', 'saturated', 'vivid', '鲜艳', '高饱和', '多彩')) add('colorful', [[5, 1]])
  if (includes('monochrome', 'black and white', 'desaturated', '黑白', '低饱和', '灰度')) add('low-saturation', [[6, 1]])
  if (includes('high contrast', 'contrasty', '高对比')) add('high-contrast', [[7, 1]])
  if (includes('low contrast', 'soft contrast', '低对比', '柔和')) add('low-contrast', [[8, 1]])
  if (includes('detailed', 'busy', 'texture', 'edges', '细节', '复杂', '纹理', '边缘')) add('detailed', [[9, 1], [21, 0.5], [22, 0.5]])
  if (includes('smooth', 'flat color', 'simple', '平滑', '纯色', '简单')) add('smooth', [[10, 1]])
  if (includes('warm', '暖色', '温暖')) add('warm', [[11, 1], [0, 0.3]])
  if (includes('cool', '冷色', '清冷')) add('cool', [[12, 1], [2, 0.3]])
  if (matched.size === 0) return undefined
  vector[23] = 0.05
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
  return {
    vector: vector.map((value) => Number((value / magnitude).toFixed(8))),
    matchedConcepts: [...matched].sort()
  }
}

function containsBoundedTerm(text: string, term: string): boolean {
  if (!/^[a-z0-9 ]+$/u.test(term)) return text.includes(term)
  let offset = text.indexOf(term)
  while (offset >= 0) {
    const before = offset === 0 ? '' : text[offset - 1]!
    const afterOffset = offset + term.length
    const after = afterOffset >= text.length ? '' : text[afterOffset]!
    if (!/[a-z0-9]/u.test(before) && !/[a-z0-9]/u.test(after)) return true
    offset = text.indexOf(term, offset + 1)
  }
  return false
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
