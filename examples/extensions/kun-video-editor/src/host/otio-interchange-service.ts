import { createHash } from 'node:crypto'
import {
  MAX_MEDIA_OTIO_TEXT_BYTES,
  type ExtensionContext,
  type JobReference
} from '@kun/extension-api'
import {
  OTIO_ADAPTER_ID,
  OTIO_ADAPTER_VERSION,
  engineError,
  exportProjectToOtio,
  serializeOtioInterchange,
  type OtioInterchangeExport,
  type VideoProject
} from '../engine/index.js'

export const OTIO_OUTPUT_MIME_TYPE = 'application/x-otio+json' as const

export type PreparedOtioInterchangeExport = {
  exported: OtioInterchangeExport
  content: string
  byteLength: number
}

export function prepareOtioInterchangeExport(
  project: VideoProject
): PreparedOtioInterchangeExport {
  const exported = exportProjectToOtio(project)
  const bytes = serializeOtioInterchange(exported)
  if (bytes.byteLength > MAX_MEDIA_OTIO_TEXT_BYTES) {
    throw engineError(
      'render_unsupported',
      `OTIO document exceeds the ${MAX_MEDIA_OTIO_TEXT_BYTES}-byte durable interchange limit`,
      { documentBytes: bytes.byteLength, limitBytes: MAX_MEDIA_OTIO_TEXT_BYTES }
    )
  }
  return {
    exported,
    content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    byteLength: bytes.byteLength
  }
}

export async function startOtioInterchangeExport(input: {
  context: ExtensionContext
  prepared: PreparedOtioInterchangeExport
  outputHandleId: string
}): Promise<JobReference> {
  const { exported } = input.prepared
  const started = await input.context.media.startFfmpegJob({
    arguments: [],
    inputs: {},
    outputs: {},
    textOutputs: {
      interchange: {
        handleId: input.outputHandleId,
        mimeType: OTIO_OUTPUT_MIME_TYPE,
        content: input.prepared.content
      }
    },
    scheduling: { priority: 'export', maxAttempts: 1, retryBaseDelayMs: 250 },
    idempotencyKey: createHash('sha256')
      .update('kun-video-otio-export\0', 'utf8')
      .update(exported.projectId, 'utf8')
      .update('\0', 'utf8')
      .update(String(exported.projectRevision), 'utf8')
      .update('\0', 'utf8')
      .update(exported.documentDigest, 'utf8')
      .update('\0', 'utf8')
      .update(input.outputHandleId, 'utf8')
      .digest('hex'),
    metadata: {
      projectId: exported.projectId,
      pinnedRevision: exported.projectRevision,
      interchangeAdapterId: OTIO_ADAPTER_ID,
      interchangeAdapterVersion: OTIO_ADAPTER_VERSION,
      documentDigest: exported.documentDigest,
      projectDigest: exported.projectDigest,
      lossCount: exported.lossManifest.entries.length,
      portableLossless: exported.lossManifest.portableLossless,
      kunRoundTripLossless: exported.lossManifest.kunRoundTripLossless
    }
  })
  return started.job
}
