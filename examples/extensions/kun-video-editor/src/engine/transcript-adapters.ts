import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  detectLocalTranscriber,
  importTranscript,
  type DetectTranscriberOptions,
  type ImportTranscriptOptions,
  type TranscriptFormat
} from './transcript.js'
import type { MediaAsset, Transcript } from './schema.js'

export type SourceFingerprint = {
  algorithm: 'sha256'
  value: string
}

export type TranscriptAdapterIdentity = {
  id: string
  version: string
  execution: 'import' | 'local'
  modelId?: string
}

export type TranscriptWordProvenance = {
  transcriptId: string
  segmentId: string
  wordId: string
  sourceWordIndex: number
  adapterId: string
  timing: 'provided' | 'interpolated'
}

export type TranscriptEvidence = {
  schemaVersion: 1
  transcript: Transcript
  adapter: TranscriptAdapterIdentity
  sourceFingerprint: SourceFingerprint
  provenance: {
    local: true
    networkUsed: false
    format: TranscriptFormat | 'local-asr'
    generatedAt: string
  }
  words: TranscriptWordProvenance[]
  warnings: string[]
}

export type TranscriptAdapterResult =
  | { outcome: 'ready'; evidence: TranscriptEvidence }
  | {
      outcome: 'unavailable'
      code: 'local_asr_disabled' | 'local_asr_adapter_unavailable' | 'local_asr_broker_unavailable'
      adapter: TranscriptAdapterIdentity
      sourceFingerprint: SourceFingerprint
      networkUsed: false
      retryable: boolean
      remediation: string
    }

export type ImportedTranscriptRequest = {
  source: string
  format: TranscriptFormat
  transcriptId: string
  asset: MediaAsset
  sourceFingerprint: SourceFingerprint
  language?: string
  now?: () => Date
}

export type LocalAsrNegotiationRequest = {
  preference: 'disabled' | 'whisper-cli'
  asset: MediaAsset
  sourceFingerprint: SourceFingerprint
  detect?: DetectTranscriberOptions
}

const IMPORT_ADAPTERS: Readonly<Record<TranscriptFormat, TranscriptAdapterIdentity>> = Object.freeze({
  srt: { id: 'kun.import.srt', version: '1.0.0', execution: 'import' },
  vtt: { id: 'kun.import.webvtt', version: '1.0.0', execution: 'import' },
  json: { id: 'kun.import.transcript-json', version: '1.0.0', execution: 'import' }
})

/**
 * Normalizes imported timed text without reading or uploading the underlying
 * media. The caller supplies the Host-derived source fingerprint so evidence
 * cannot silently drift to a reauthorized source.
 */
export function adaptImportedTranscript(request: ImportedTranscriptRequest): TranscriptAdapterResult {
  assertSourceFingerprint(request.sourceFingerprint)
  const adapter = IMPORT_ADAPTERS[request.format]
  const options: ImportTranscriptOptions = {
    format: request.format,
    transcriptId: request.transcriptId,
    asset: request.asset,
    ...(request.language === undefined ? {} : { language: request.language })
  }
  const transcript = importTranscript(request.source, options)
  return {
    outcome: 'ready',
    evidence: {
      schemaVersion: 1,
      transcript,
      adapter,
      sourceFingerprint: { ...request.sourceFingerprint },
      provenance: {
        local: true,
        networkUsed: false,
        format: request.format,
        generatedAt: (request.now ?? (() => new Date()))().toISOString()
      },
      words: transcript.segments.flatMap((segment) =>
        (segment.words ?? []).map((word, sourceWordIndex) => ({
          transcriptId: transcript.id,
          segmentId: segment.id,
          wordId: word.id,
          sourceWordIndex,
          adapterId: adapter.id,
          timing: 'provided' as const
        }))
      ),
      warnings: transcript.segments.some((segment) => !segment.words?.length)
        ? ['Some transcript cues have segment timing only; word-precise destructive edits require word timestamps.']
        : []
    }
  }
}

/**
 * Negotiates the currently claimed local-ASR path. The public Extension API does
 * not expose an arbitrary native-process broker, so even a discovered
 * whisper-cli executable is reported as unavailable instead of being invoked
 * with a raw path. This keeps the fallback honest and upload-free.
 */
export async function negotiateLocalAsr(
  request: LocalAsrNegotiationRequest
): Promise<TranscriptAdapterResult> {
  assertSourceFingerprint(request.sourceFingerprint)
  const adapter: TranscriptAdapterIdentity = {
    id: 'kun.local.whisper-cli',
    version: '1.0.0',
    execution: 'local',
    modelId: 'user-configured'
  }
  if (request.preference === 'disabled') {
    return {
      outcome: 'unavailable',
      code: 'local_asr_disabled',
      adapter,
      sourceFingerprint: { ...request.sourceFingerprint },
      networkUsed: false,
      retryable: true,
      remediation: 'Enable a supported local transcriber in this workspace, or import timed SRT, WebVTT, or transcript JSON.'
    }
  }
  const capability = await detectLocalTranscriber(request.detect)
  if (!capability.available) {
    return {
      outcome: 'unavailable',
      code: 'local_asr_adapter_unavailable',
      adapter,
      sourceFingerprint: { ...request.sourceFingerprint },
      networkUsed: false,
      retryable: true,
      remediation: capability.remediation
    }
  }
  return {
    outcome: 'unavailable',
    code: 'local_asr_broker_unavailable',
    adapter,
    sourceFingerprint: { ...request.sourceFingerprint },
    networkUsed: false,
    retryable: false,
    remediation: 'whisper-cli was detected, but this Kun Extension API version has no approved local-ASR process broker. Import timed transcript evidence; no media was uploaded and no text was invented.'
  }
}

/**
 * Creates a non-reversible, path-free identity from the Host-granted asset
 * metadata. A changed opaque grant or probed stream changes this value. It is
 * an identity fingerprint, not a claim that the extension hashed media bytes.
 */
export function fingerprintAssetIdentity(asset: MediaAsset): SourceFingerprint {
  const identity = JSON.stringify({
    id: asset.id,
    handle: asset.mediaHandleId ?? null,
    workspaceRelativePath: asset.workspaceRelativePath ?? null,
    durationUs: asset.durationUs,
    container: asset.container,
    video: asset.video ?? null,
    audio: asset.audio ?? null
  })
  return { algorithm: 'sha256', value: createHash('sha256').update(identity).digest('hex') }
}

export function assertSourceFingerprint(value: SourceFingerprint): void {
  if (value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/u.test(value.value)) {
    throw engineError('transcript_invalid', 'Source fingerprint must be a lowercase SHA-256 digest')
  }
}
