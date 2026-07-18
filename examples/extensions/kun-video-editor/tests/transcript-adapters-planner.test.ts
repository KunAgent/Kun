import { describe, expect, it } from 'vitest'
import {
  adaptImportedTranscript,
  applyTranscriptEditPlan,
  fingerprintAssetIdentity,
  negotiateLocalAsr,
  planTranscriptEdits
} from '../src/engine/index.js'
import { makeItem, makeProject } from './fixtures.js'

describe('provider-neutral transcript evidence and edit planning', () => {
  it('normalizes every imported format with source identity and word provenance', () => {
    const asset = makeProject().assets[0]!
    const fingerprint = fingerprintAssetIdentity(asset)
    const json = adaptImportedTranscript({
      source: JSON.stringify({
        language: 'en',
        segments: [{
          id: 'segment-json', startUs: 0, endUs: 1_000_000, text: 'Hello world',
          words: [
            { id: 'word-hello', startUs: 0, endUs: 400_000, text: 'Hello', confidence: 0.98 },
            { id: 'word-world', startUs: 500_000, endUs: 900_000, text: 'world', confidence: 0.96 }
          ]
        }]
      }),
      format: 'json',
      transcriptId: 'transcript-adapter-json',
      asset,
      sourceFingerprint: fingerprint,
      now: () => new Date('2026-01-02T00:00:00.000Z')
    })
    expect(json.outcome).toBe('ready')
    if (json.outcome !== 'ready') throw new Error('expected transcript evidence')
    expect(json.evidence).toMatchObject({
      adapter: { id: 'kun.import.transcript-json', execution: 'import' },
      sourceFingerprint: fingerprint,
      provenance: { local: true, networkUsed: false, format: 'json' }
    })
    expect(json.evidence.words).toEqual([
      expect.objectContaining({ segmentId: 'segment-json', wordId: 'word-hello', sourceWordIndex: 0, timing: 'provided' }),
      expect.objectContaining({ segmentId: 'segment-json', wordId: 'word-world', sourceWordIndex: 1, timing: 'provided' })
    ])

    for (const [format, source] of [
      ['srt', '1\n00:00:00,000 --> 00:00:01,000\nHello\n'],
      ['vtt', 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n']
    ] as const) {
      const adapted = adaptImportedTranscript({
        source,
        format,
        transcriptId: `transcript-adapter-${format}`,
        asset,
        sourceFingerprint: fingerprint
      })
      expect(adapted.outcome).toBe('ready')
      if (adapted.outcome === 'ready') {
        expect(adapted.evidence.adapter.id).toContain(format === 'vtt' ? 'webvtt' : format)
        expect(adapted.evidence.warnings[0]).toContain('word-precise')
      }
    }
    expect(fingerprint.value).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(json)).not.toContain(asset.mediaHandleId)
  })

  it('returns actionable local-ASR states without upload, fabricated text, or executable disclosure', async () => {
    const asset = makeProject().assets[0]!
    const sourceFingerprint = fingerprintAssetIdentity(asset)
    const disabled = await negotiateLocalAsr({ preference: 'disabled', asset, sourceFingerprint })
    expect(disabled).toMatchObject({
      outcome: 'unavailable',
      code: 'local_asr_disabled',
      networkUsed: false,
      retryable: true
    })
    const missing = await negotiateLocalAsr({
      preference: 'whisper-cli',
      asset,
      sourceFingerprint,
      detect: { env: { PATH: '' }, canExecute: async () => false }
    })
    expect(missing).toMatchObject({
      outcome: 'unavailable',
      code: 'local_asr_adapter_unavailable',
      networkUsed: false
    })
    const detectedButUnbrokered = await negotiateLocalAsr({
      preference: 'whisper-cli',
      asset,
      sourceFingerprint,
      detect: {
        configuredPath: '/opt/local/bin/whisper-cli',
        env: { PATH: '' },
        canExecute: async () => true
      }
    })
    expect(detectedButUnbrokered).toMatchObject({
      outcome: 'unavailable',
      code: 'local_asr_broker_unavailable',
      networkUsed: false,
      retryable: false
    })
    expect(JSON.stringify(detectedButUnbrokered)).not.toContain('/opt/local/bin')
    expect(detectedButUnbrokered).not.toHaveProperty('evidence.transcript')
  })

  it('maps word evidence through trims, speed, and linked items before one transaction', () => {
    const project = makeProject()
    project.captions = []
    project.items = [{
      ...makeItem('item-video', 10, 500_000, 2_500_000),
      durationFrames: 30,
      speed: { numerator: 2, denominator: 1 }
    }]
    project.assets.push({
      id: 'asset-audio',
      name: 'Interview audio.wav',
      kind: 'audio',
      mediaHandleId: 'media_asset_audio',
      durationUs: 10_000_000,
      container: 'wav',
      audio: { codec: 'pcm_s16le', sampleRate: 48_000, channels: 2 },
      transcriptIds: []
    })
    project.items.push({
      ...makeItem('item-audio', 10, 0, 1_000_000, 'audio-1'),
      assetId: 'asset-audio',
      durationFrames: 30
    })
    const transcript = structuredClone(project.transcripts[0]!)
    transcript.segments = [{
      id: 'segment-edit', startUs: 500_000, endUs: 2_500_000, text: 'keep um keep',
      words: [
        { id: 'word-keep-1', startUs: 600_000, endUs: 900_000, text: 'keep' },
        { id: 'word-um', startUs: 1_100_000, endUs: 1_300_000, text: 'um' },
        { id: 'word-keep-2', startUs: 1_400_000, endUs: 1_900_000, text: 'keep' }
      ]
    }]
    project.transcripts = [transcript]
    const plan = planTranscriptEdits(project, {
      kind: 'words', transcript, wordIds: ['word-um']
    }, {
      linkGroups: [{ id: 'link-av', itemIds: ['item-video', 'item-audio'] }]
    })
    expect(plan).toMatchObject({
      expectedRevision: 0,
      intent: 'words',
      wordIds: ['word-um'],
      requiresWordIndexRefresh: true,
      affectedItemIds: ['item-audio', 'item-video']
    })
    expect(plan.mappedRanges.find(({ itemId }) => itemId === 'item-video')).toMatchObject({
      timelineStartFrame: 19,
      timelineEndFrame: 22,
      sourceStartUs: 1_100_000,
      sourceEndUs: 1_300_000
    })
    expect(plan.mappedRanges.find(({ itemId }) => itemId === 'item-audio')).toMatchObject({
      linkGroupId: 'link-av',
      propagatedFromItemId: 'item-video'
    })
    const applied = applyTranscriptEditPlan(project, plan)
    expect(applied.receipt).toMatchObject({
      previousRevision: 0,
      refreshWordIndices: true,
      evidenceDigest: plan.evidenceDigest
    })
    expect(applied.receipt.removedSourceRanges.map(({ assetId }) => assetId)).toEqual(['asset-1', 'asset-audio'])
    expect(applied.project).not.toBe(project)
    expect(project.items).toHaveLength(2)

    const changed = { ...project, currentRevision: 1 }
    expect(() => applyTranscriptEditPlan(changed, plan)).toThrowError(/stale/u)
    expect(() => planTranscriptEdits(project, {
      kind: 'words', transcript, wordIds: ['missing-word']
    })).toThrowError(/missing timed evidence/u)
  })

  it('plans filler, silence, and explicit ranges only from source evidence', () => {
    const project = makeProject()
    const transcript = project.transcripts[0]!
    expect(planTranscriptEdits(project, { kind: 'fillers', transcript }).sourceRanges).toEqual([{
      assetId: 'asset-1', startUs: 1_100_000, endUs: 1_300_000, reason: 'filler'
    }])
    expect(planTranscriptEdits(project, {
      kind: 'silence', transcript, assetDurationUs: project.assets[0]!.durationUs, minimumSilenceUs: 500_000
    }).sourceRanges).toContainEqual({
      assetId: 'asset-1', startUs: 4_000_000, endUs: 10_000_000, reason: 'silence'
    })
    expect(planTranscriptEdits(project, {
      kind: 'explicit-ranges', ranges: [{ assetId: 'asset-1', startUs: 200_000, endUs: 300_000 }]
    }).sourceRanges[0]).toMatchObject({ reason: 'selection' })
  })
})
