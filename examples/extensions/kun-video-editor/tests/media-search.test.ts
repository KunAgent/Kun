import { describe, expect, it } from 'vitest'
import {
  applyTimelineOperations,
  planSearchResultInsertion,
  previewSearchResult,
  searchProjectMedia
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

describe('bounded media search', () => {
  it('pages filename and spoken evidence while preserving direct source ranges', () => {
    const project = makeProject()
    project.assets.push({
      id: 'asset-audio',
      name: 'Interview room tone.wav',
      kind: 'audio',
      mediaHandleId: 'media_audio_search_0001',
      durationUs: 4_000_000,
      container: 'wav',
      audio: { codec: 'pcm_s16le', sampleRate: 48_000, channels: 1 },
      transcriptIds: ['transcript-audio']
    })
    project.transcripts.push({
      id: 'transcript-audio',
      assetId: 'asset-audio',
      language: 'en',
      provenance: 'json',
      segments: [{ id: 'room-segment', startUs: 500_000, endUs: 1_500_000, text: 'Interview room introduction' }]
    })

    const first = searchProjectMedia(project, {
      query: 'interview',
      pageSize: 1,
      spokenCompleteness: 'partial'
    })
    expect(first).toMatchObject({
      totalMatches: 3,
      completeness: { filename: 'complete', spoken: 'partial', indexedTranscriptCount: 2 },
      results: [{
        evidenceKind: 'spoken',
        assetId: 'asset-audio',
        sourceRange: { assetId: 'asset-audio', startUs: 500_000, endUs: 1_500_000 },
        scoreSemantics: 'uncalibrated',
        indexCompleteness: 'partial'
      }]
    })
    expect(first.nextCursor).toBeDefined()
    const second = searchProjectMedia(project, {
      query: 'interview',
      pageSize: 1,
      cursor: first.nextCursor,
      spokenCompleteness: 'partial'
    })
    expect(second.results[0]!.id).not.toBe(first.results[0]!.id)
    expect(previewSearchResult(first.results[0]!)).toEqual({
      kind: 'preview-source-range',
      range: { assetId: 'asset-audio', startUs: 500_000, endUs: 1_500_000 }
    })
    expect(() => searchProjectMedia(project, {
      query: 'different-query',
      cursor: first.nextCursor
    })).toThrowError(/cursor/u)
  })

  it('turns a search result into one standard transactional insert operation', () => {
    const project = makeProject()
    const result = searchProjectMedia(project, { query: 'world', kinds: ['spoken'] }).results[0]!
    const operation = planSearchResultInsertion(project, {
      result,
      trackId: 'video-2',
      timelineStartFrame: 200,
      itemId: 'search-insert-world'
    })
    expect(operation).toMatchObject({
      type: 'add-item',
      item: {
        id: 'search-insert-world',
        assetId: 'asset-1',
        trackId: 'video-2',
        timelineStartFrame: 200,
        durationFrames: 30,
        sourceStartUs: 2_000_000,
        sourceEndUs: 3_000_000
      }
    })
    const applied = applyTimelineOperations(project, [operation])
    expect(applied.changedIds).toContain('search-insert-world')
    expect(applied.project.items.find(({ id }) => id === 'search-insert-world')).toBeDefined()
    expect(project.items.find(({ id }) => id === 'search-insert-world')).toBeUndefined()
  })
})
