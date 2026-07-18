import { describe, expect, it } from 'vitest'
import {
  collectTimelineSnapTargets,
  snapTimelineFrame
} from '../src/engine/timeline-snap.js'

describe('sticky timeline snap', () => {
  const targets = collectTimelineSnapTargets({
    playheadFrame: 100,
    clips: [
      { id: 'clip-a', trackId: 'video-1', startFrame: 20, endFrame: 80 },
      { id: 'clip-b', trackId: 'video-2', startFrame: 105, endFrame: 160 }
    ],
    captions: [{ id: 'caption-a', startFrame: 102, endFrame: 130 }],
    markers: [{ id: 'marker-a', frame: 104, label: 'Review' }],
    beats: [{ id: 'beat-a', frame: 103 }]
  })

  it('collects deterministic playhead, clip, caption, marker, and beat targets', () => {
    expect(targets.map(({ id }) => id)).toEqual([
      'clip-a:start',
      'clip-a:end',
      'playhead',
      'caption-a:start',
      'beat-a',
      'marker-a',
      'clip-b:start',
      'caption-a:end',
      'clip-b:end'
    ])
  })

  it('selects the closest target with stable priority and reports acquisition', () => {
    expect(snapTimelineFrame({
      requestedFrame: 101,
      pixelsPerFrame: 2,
      thresholdPixels: 8,
      targets
    })).toMatchObject({
      frame: 100,
      snapped: true,
      sticky: false,
      target: { kind: 'playhead' },
      deltaFrames: -1,
      feedback: 'acquired'
    })
  })

  it('prefers a same-track edge for an exact tie', () => {
    const tied = collectTimelineSnapTargets({
      clips: [
        { id: 'left', trackId: 'video-1', startFrame: 90, endFrame: 100 },
        { id: 'right', trackId: 'video-2', startFrame: 102, endFrame: 120 }
      ]
    })
    expect(snapTimelineFrame({
      requestedFrame: 101,
      pixelsPerFrame: 2,
      thresholdPixels: 4,
      preferredTrackId: 'video-2',
      targets: tied
    }).target).toMatchObject({ id: 'right:start', trackId: 'video-2' })
  })

  it('holds the prior snap through hysteresis and reports release', () => {
    const acquired = snapTimelineFrame({
      requestedFrame: 101,
      pixelsPerFrame: 2,
      thresholdPixels: 6,
      targets
    })
    const previous = {
      targetId: acquired.target!.id,
      frame: acquired.target!.frame,
      kind: acquired.target!.kind
    }
    expect(snapTimelineFrame({
      requestedFrame: 104,
      pixelsPerFrame: 2,
      thresholdPixels: 6,
      releasePixels: 10,
      previous,
      targets
    })).toMatchObject({ frame: 100, sticky: true, feedback: 'held' })
    expect(snapTimelineFrame({
      requestedFrame: 200,
      pixelsPerFrame: 2,
      thresholdPixels: 6,
      releasePixels: 10,
      previous,
      targets
    })).toMatchObject({ frame: 200, snapped: false, feedback: 'released' })
  })

  it('excludes the dragged clip from targets', () => {
    const filtered = collectTimelineSnapTargets({
      clips: [{ id: 'dragged', trackId: 'video-1', startFrame: 10, endFrame: 20 }],
      excludeIds: ['dragged']
    })
    expect(filtered).toEqual([])
  })
})
