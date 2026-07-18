import type { TimelineItem, VideoProject } from '../src/engine/index.js'

export function makeItem(
  id: string,
  timelineStartFrame: number,
  sourceStartUs: number,
  sourceEndUs: number,
  trackId = 'video-1'
): TimelineItem {
  return {
    id,
    assetId: 'asset-1',
    trackId,
    timelineStartFrame,
    durationFrames: (sourceEndUs - sourceStartUs) / 100_000 * 3,
    sourceStartUs,
    sourceEndUs,
    speed: { numerator: 1, denominator: 1 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0
  }
}

export function makeProject(): VideoProject {
  const tracks: VideoProject['tracks'] = [
    { id: 'video-1', name: 'Video 1', kind: 'video', order: 0, overlap: 'reject' },
    { id: 'video-2', name: 'Video 2', kind: 'video', order: 1, overlap: 'reject' },
    { id: 'audio-1', name: 'Audio 1', kind: 'audio', order: 2, overlap: 'mix' },
    { id: 'captions-1', name: 'Captions', kind: 'caption', order: 3, overlap: 'reject' }
  ]
  const items = [
    makeItem('item-1', 0, 0, 3_000_000),
    makeItem('item-2', 90, 3_000_000, 6_000_000)
  ]
  const captions: VideoProject['captions'] = [{
    id: 'caption-1',
    trackId: 'captions-1',
    startFrame: 0,
    endFrame: 45,
    text: 'Hello <Kun>',
    placement: 'bottom'
  }]
  return {
    schemaVersion: 2,
    id: 'demo-project',
    name: 'Demo Project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fps: { numerator: 30, denominator: 1 },
    canvas: {
      preset: '16:9',
      width: 1920,
      height: 1080,
      fit: 'fit',
      background: '#000000'
    },
    assets: [{
      id: 'asset-1',
      name: 'Interview.mp4',
      kind: 'video',
      mediaHandleId: 'media_asset_1',
      durationUs: 10_000_000,
      container: 'mov,mp4',
      video: {
        codec: 'h264',
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30000, denominator: 1001 }
      },
      audio: { codec: 'aac', sampleRate: 48_000, channels: 2 },
      transcriptIds: ['transcript-1']
    }],
    tracks,
    items,
    captions,
    sequences: [{
      id: 'sequence-main',
      name: 'Demo Project',
      tracks: structuredClone(tracks),
      items: structuredClone(items),
      captions: structuredClone(captions),
      viewState: { zoom: 1, scrollFrame: 0, open: true }
    }],
    activeSequenceId: 'sequence-main',
    linkGroups: [],
    selection: {
      generation: 0,
      revision: 0,
      sequenceId: 'sequence-main',
      playheadFrame: 0,
      selectedAssetIds: [],
      selectedItemIds: [],
      selectedCaptionIds: [],
      selectedWordIds: []
    },
    transcripts: [{
      id: 'transcript-1',
      assetId: 'asset-1',
      language: 'en',
      provenance: 'json',
      segments: [
        {
          id: 'segment-1',
          startUs: 0,
          endUs: 1_000_000,
          text: 'Hello',
          words: [{ id: 'word-1', startUs: 0, endUs: 500_000, text: 'Hello' }]
        },
        {
          id: 'segment-2',
          startUs: 1_000_000,
          endUs: 2_000_000,
          text: 'um',
          words: [{ id: 'word-2', startUs: 1_100_000, endUs: 1_300_000, text: 'um' }]
        },
        { id: 'segment-3', startUs: 2_000_000, endUs: 3_000_000, text: 'world' },
        { id: 'segment-4', startUs: 3_000_000, endUs: 4_000_000, text: 'Again' }
      ]
    }],
    derivedReferences: [],
    currentRevision: 0,
    eventGeneration: 0,
    revisions: [{
      revision: 0,
      parentRevision: null,
      author: 'system',
      sourceOperation: 'test.create',
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'Test fixture',
      operations: [],
      inverseOperations: []
    }],
    undoStack: [],
    redoStack: [],
    agentUndoStack: [],
    recovery: {
      mode: 'healthy',
      unreadableManifestKinds: [],
      interruptedJobIds: [],
      notes: []
    }
  }
}
