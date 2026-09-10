import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppSettingsV1 } from '@shared/app-settings'
import {
  defaultKunRuntimeSettings,
  defaultKunSpeakSettings
} from '@shared/app-settings-kun-defaults'
import type { ChatBlock } from '../../agent/types'
import { useSpeakStore } from '../../stores/speak-store'
import { AssistantSpeakButton, speakButtonVisible, speakErrorLabel } from './AssistantSpeakButton'
import { speakEnabledFromApp } from './use-speak-enabled'
import { MessageBubble, assistantActionRowClass } from './message-timeline-bubbles'

const labels: Record<string, string> = {
  speakAnswer: 'Speak',
  speakFailed: 'Could not generate speech: {{message}}',
  speakUnavailable: 'Local speech is unavailable in this build.',
  speakNothingToRead: 'This answer has no text to read aloud.',
  speakModelMissing: 'Download a Kokoro voice model in Settings to use Speak.'
}

const t = (key: string, options?: Record<string, unknown>): string =>
  (labels[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))

function assistantBlock(id: string): ChatBlock {
  return {
    kind: 'assistant',
    id,
    text: 'The run finished.',
    createdAt: '2026-06-07T00:00:00.000Z'
  } as ChatBlock
}

describe('speakErrorLabel', () => {
  it('translates the controller error keys', () => {
    expect(speakErrorLabel(t, 'speakUnavailable')).toBe('Local speech is unavailable in this build.')
    expect(speakErrorLabel(t, 'speakNothingToRead')).toBe('This answer has no text to read aloud.')
    expect(speakErrorLabel(t, 'speakModelMissing'))
      .toBe('Download a Kokoro voice model in Settings to use Speak.')
  })

  it('wraps an arbitrary runtime message', () => {
    expect(speakErrorLabel(t, 'HTTP 503')).toBe('Could not generate speech: HTTP 503')
  })

  it('returns nothing for an empty error', () => {
    expect(speakErrorLabel(t, '')).toBe('')
  })
})

describe('AssistantSpeakButton', () => {
  beforeEach(() => {
    useSpeakStore.getState().reset()
    useSpeakStore.getState().clearError()
  })

  it('renders nothing until the speech bridge is confirmed', () => {
    const markup = renderToStaticMarkup(
      createElement(AssistantSpeakButton, { blockId: 'msg_1', text: 'hello' })
    )

    expect(markup).toBe('')
  })

  it('never reads the preload bridge during render', () => {
    const bridge = (globalThis as { window?: { kunGui?: unknown } }).window?.kunGui

    expect(() =>
      renderToStaticMarkup(createElement(AssistantSpeakButton, { blockId: 'msg_1', text: 'hi' }))
    ).not.toThrow()
    expect(bridge).toBeUndefined()
  })
})

describe('speakButtonVisible', () => {
  it('shows the action once the bridge and the toggle are both confirmed', () => {
    expect(speakButtonVisible(true, true)).toBe(true)
  })

  it('hides the action while the settings toggle is off', () => {
    expect(speakButtonVisible(true, false)).toBe(false)
  })

  it('hides the action until the first settings read lands', () => {
    expect(speakButtonVisible(true, null)).toBe(false)
  })

  it('hides the action when the speech bridge is missing', () => {
    expect(speakButtonVisible(false, true)).toBe(false)
  })
})

describe('speakEnabledFromApp', () => {
  const appSettings = (kun: Record<string, unknown>): AppSettingsV1 =>
    ({ agents: { kun } }) as unknown as AppSettingsV1

  it('reads the toggle out of the Kun runtime settings', () => {
    const kun = defaultKunRuntimeSettings() as unknown as Record<string, unknown>

    expect(speakEnabledFromApp(appSettings(kun))).toBe(defaultKunSpeakSettings().enabled)

    expect(
      speakEnabledFromApp(appSettings({ ...kun, speak: { ...defaultKunSpeakSettings(), enabled: false } }))
    ).toBe(false)
  })

  it('keeps the action available when older settings carry no speak block', () => {
    const { speak: _speak, ...withoutSpeak } =
      defaultKunRuntimeSettings() as unknown as Record<string, unknown>

    expect(speakEnabledFromApp(appSettings(withoutSpeak))).toBe(defaultKunSpeakSettings().enabled)
  })
})

describe('assistant action row visibility', () => {
  beforeEach(() => {
    useSpeakStore.getState().reset()
  })

  it('is hover-only while nothing is speaking', () => {
    const markup = renderToStaticMarkup(
      createElement(MessageBubble, { block: assistantBlock('msg_1') })
    )

    expect(markup).toContain('opacity-0')
  })

  // The row's visibility is computed from the speak store, which zustand
  // serves from its initial state under renderToStaticMarkup; assert the rule
  // that the component applies rather than an SSR snapshot of it.
  it('pins the row open for the answer that is speaking, so stop is reachable', () => {
    expect(assistantActionRowClass(true)).toContain('opacity-100')
    expect(assistantActionRowClass(true)).not.toContain('opacity-0')
  })

  it('leaves every other answer hover-only', () => {
    expect(assistantActionRowClass(false)).toContain('opacity-0')
    expect(assistantActionRowClass(false)).toContain('group-hover/message:opacity-100')
  })
})
