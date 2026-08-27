import { describe, expect, it } from 'vitest'
import { timelineTurnIsProcessing } from './MessageTimeline'
import { shouldAnimateAssistantStream } from './message-timeline-bubbles'

describe('timelineTurnIsProcessing unconfirmed busy', () => {
  it('renders history settled while a hydrated running claim is unconfirmed', () => {
    // A persisted snapshot says running, but no live event confirmed it yet:
    // the timeline must not replay live-progress UI over finished history.
    expect(timelineTurnIsProcessing({
      busy: true,
      busyUnconfirmed: true,
      isLatestTurn: true,
      turnPending: false,
      hasLiveStream: false
    })).toBe(false)
    // Live stream evidence still shows progress even while unconfirmed.
    expect(timelineTurnIsProcessing({
      busy: true,
      busyUnconfirmed: true,
      isLatestTurn: true,
      turnPending: false,
      hasLiveStream: true
    })).toBe(true)
    // Once the runtime confirms the turn, normal processing UI returns.
    expect(timelineTurnIsProcessing({
      busy: true,
      busyUnconfirmed: false,
      isLatestTurn: true,
      turnPending: false,
      hasLiveStream: false
    })).toBe(true)
  })
})

describe('assistant stream presentation', () => {
  it('folds replayed output instantly while a selected thread catches up', () => {
    expect(shouldAnimateAssistantStream({
      isLiveAssistant: true,
      busyUnconfirmed: false,
      catchingUpThread: true
    })).toBe(false)
  })

  it('animates only confirmed live output after catch-up completes', () => {
    expect(shouldAnimateAssistantStream({
      isLiveAssistant: true,
      busyUnconfirmed: false,
      catchingUpThread: false
    })).toBe(true)
    expect(shouldAnimateAssistantStream({
      isLiveAssistant: true,
      busyUnconfirmed: true,
      catchingUpThread: false
    })).toBe(false)
  })
})
