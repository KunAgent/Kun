import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

type EmptyHeroProps = Parameters<typeof MessageTimelineEmptyHero>[0]

/** Runtime availability stays inside the ordinary home surface. */

function renderEmptyHero(patch: Partial<EmptyHeroProps> = {}): string {
  return renderToStaticMarkup(
    createElement(MessageTimelineEmptyHero, {
      route: 'chat',
      ready: true,
      hasWorkspace: true,
      runtimeError: null,
      activeClawChannel: null,
      onPickWorkspace: () => undefined,
      onRetry: () => undefined,
      onOpenSettings: () => undefined,
      onSelectSuggestion: () => undefined,
      ...patch
    })
  )
}

function renderOfflineHero(runtimeError: string | null = null): string {
  return renderEmptyHero({ ready: false, runtimeError })
}

describe('MessageTimelineEmptyHero — chat init welcome', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the welcome without page-level task controls or starter actions', () => {
    const html = renderEmptyHero()

    expect(html).toContain('ds-chat-empty-hero')
    expect(html).toContain('data-home-hero-content')
    expect(html).toContain('min-h-[clamp(190px,23vh,240px)]')
    expect(html).not.toContain('translate-y-')
    expect(html).toContain('What would you like to do with Kun today?')
    expect(html).toContain('Start with an idea, build it with code, or explore a design.')
    expect(html).not.toContain('ds-runtime-wake-stage')
    expect(html).not.toContain('ds-kun-state-')
    expect(html).not.toContain('ds-initial-usage-heatmap')
    expect(html).not.toContain('Expand calendar')
    expect(html).not.toContain('data-task-surface-selector')
    expect(html).not.toContain('role="radiogroup"')
    expect(html).not.toContain('data-task-starters')
    expect(html).not.toContain('Understand this codebase')
    expect(html).not.toContain('Build a feature')
    expect(html).not.toContain('Fix a bug')
  })

  it('keeps task controls out of the page-level hero', () => {
    const html = renderEmptyHero()

    expect(html).not.toContain('data-task-surface-selector')
    expect(html).not.toContain('ds-composer-shell')
    expect(html).not.toContain('ds-composer-task-profile')
  })

  it('keeps the static welcome copy visible in focus mode without restoring the usage panel', () => {
    const html = renderEmptyHero({ focusModeEnabled: true })

    expect(html).toContain('ds-chat-empty-hero')
    expect(html).toContain('What would you like to do with Kun today?')
    expect(html).toContain('Start with an idea, build it with code, or explore a design.')
    expect(html).not.toContain('ds-kun-state-')
    expect(html).not.toContain('ds-initial-usage-heatmap')
  })
})

describe('MessageTimelineEmptyHero — runtime status on the chat home', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('uses the waking title when no runtime error is available', () => {
    const html = renderOfflineHero(null)
    expect(html).toContain('ds-chat-empty-hero')
    expect(html).toContain('What would you like to do with Kun today?')
    expect(html).not.toContain('data-task-surface-selector')
    expect(html).toContain('data-runtime-home-status')
    expect(html).not.toContain('ds-runtime-wake-hero')
    expect(html).toContain('Kun is waking the local agent')
    expect(html).not.toContain('Cannot connect to the local runtime')
  })

  it('switches to the error title and surfaces the localized error when a runtime error is provided', () => {
    const portConflict = i18n.t('common:runtimePortConflict')
    const html = renderOfflineHero(portConflict)
    expect(html).toContain('What would you like to do with Kun today?')
    expect(html).toContain('data-runtime-home-status')
    expect(html).not.toContain('ds-runtime-wake-hero')
    // New error title should appear (so users see the failure immediately)
    expect(html).toContain('Cannot connect to the local runtime')
    // The old "waking" title must NOT appear — that's the bug we're fixing
    expect(html).not.toContain('Kun is waking the local agent')
    // The specific localized port-conflict message should appear in the body
    expect(html).toContain(portConflict)
  })

  it('treats whitespace-only runtimeError as no error', () => {
    const html = renderOfflineHero('   \n  ')
    // Falls back to the generic waking hero
    expect(html).toContain('Kun is waking the local agent')
    expect(html).not.toContain('Cannot connect to the local runtime')
  })

  it('keeps both the retry and open-settings actions visible on the error hero', () => {
    const html = renderOfflineHero(i18n.t('common:runtimePortConflict'))
    expect(html).toContain('Retry')
    expect(html).toContain('Open Settings')
  })

  it('does not render the animated Kun stage while loading or after an error', () => {
    const waking = renderOfflineHero(null)
    expect(waking).not.toContain('ds-runtime-wake-stage')
    expect(waking).not.toContain('is-waking')
    expect(waking).not.toContain('ds-runtime-wake-zzz')
    expect(waking).not.toContain('ds-runtime-wake-sonar')
    expect(waking).not.toContain('ds-runtime-wake-caret')
    expect(waking).not.toContain('ds-kun-state-')

    const errored = renderOfflineHero(i18n.t('common:runtimePortConflict'))
    expect(errored).not.toContain('ds-runtime-wake-stage')
    expect(errored).not.toContain('is-waking')
    expect(errored).not.toContain('ds-runtime-wake-zzz')
    expect(errored).not.toContain('ds-runtime-wake-sonar')
    expect(errored).not.toContain('ds-runtime-wake-caret')
    expect(errored).not.toContain('ds-kun-state-')
  })

  it('keeps the channel-specific recovery hero on the Claw route', () => {
    const html = renderEmptyHero({ route: 'claw', ready: false })

    expect(html).toContain('ds-runtime-wake-hero')
    expect(html).not.toContain('ds-chat-empty-hero')
    expect(html).not.toContain('data-runtime-home-status')
  })
})

describe('MessageTimelineEmptyHero — runtime status on the chat home (zh-CN)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('uses 正在唤醒 title when no runtime error is available', () => {
    const html = renderOfflineHero(null)
    expect(html).toContain('今天想和 Kun 一起做什么？')
    expect(html).not.toContain('data-task-surface-selector')
    expect(html).toContain('data-runtime-home-status')
    expect(html).not.toContain('ds-runtime-wake-hero')
    expect(html).toContain('正在唤醒本地智能体')
    expect(html).not.toContain('无法连接到本地运行时')
  })

  it('switches to 无法连接到本地运行时 title and surfaces the localized port-conflict error', () => {
    const portConflict = i18n.t('common:runtimePortConflict')
    const html = renderOfflineHero(portConflict)
    expect(html).toContain('无法连接到本地运行时')
    expect(html).not.toContain('正在唤醒本地智能体')
    expect(html).toContain(portConflict)
  })

  it('uses the approved text-only init copy when the runtime is ready', () => {
    const html = renderEmptyHero()

    expect(html).toContain('今天想和 Kun 一起做什么？')
    expect(html).toContain('从一个想法开始，编码实现，或探索设计。')
    expect(html).not.toContain('ds-kun-state-')
    expect(html).not.toContain('ds-initial-usage-heatmap')
  })
})
