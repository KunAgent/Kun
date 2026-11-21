// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import type { TimelineSurface } from './timeline-surface'
import {
  MessageTimeline,
  TimelineJumpPreviewTitle,
  activeTimelineTurnKey,
  timelineJumpRailLeft,
  timelineJumpRailPreviewLeft,
  timelineJumpPreviewMetadata,
  timelineJumpPreviewTop,
  timelineJumpWaveDistance
} from './MessageTimeline'

describe('MessageTimeline turn rail', () => {
  let host: HTMLDivElement
  let root: Root
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    scrollIntoView.mockClear()
    vi.unstubAllGlobals()
  })

  async function render(turnCount: number, surface: TimelineSurface): Promise<void> {
    const blocks = Array.from({ length: turnCount }, (_, index): ChatBlock[] => [
      { kind: 'user', id: `user-${index}`, turnId: `turn-${index}`, text: `Question ${index}` },
      { kind: 'assistant', id: `reply-${index}`, turnId: `turn-${index}`, text: `Answer ${index}` }
    ]).flat()
    await act(async () => root.render(createElement(MessageTimeline, {
      blocks,
      activeThreadId: 'thread-rail',
      surface,
      live: '',
      liveReasoning: '',
      runtimeConnection: 'ready',
      onRetryConnection: () => undefined,
      onOpenSettings: () => undefined
    })))
  }

  it.each([1, 2])('previews and jumps to a question in a %i-turn desktop session', async (turnCount) => {
    await render(turnCount, 'desktop')
    const marks = host.querySelectorAll<HTMLButtonElement>('.timeline-jump-rail button')
    expect(marks).toHaveLength(turnCount)

    await act(async () => marks[0].focus())
    const preview = host.querySelector('[role="tooltip"]')
    expect(preview?.textContent).toContain('Question 0')
    expect(preview?.textContent).toContain('Answer 0')

    await act(async () => marks[0].click())
    expect(scrollIntoView.mock.contexts).toContain(host.querySelector('[data-turn-id="turn-0"]'))
  })

  it('does not render the desktop marks on mobile', async () => {
    await render(3, 'mobile')
    expect(host.querySelector('.timeline-jump-rail')).toBeNull()
  })
})

describe('TimelineJumpPreviewTitle', () => {
  it('shows the question number before the prompt preview', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineJumpPreviewTitle, {
        index: 12,
        title: '交互逻辑都改完了吗'
      })
    )

    expect(html).toContain('timeline-jump-rail-preview-turn-index')
    expect(html).toContain('>12<')
    expect(html).toContain('交互逻辑都改完了吗')
  })
})

describe('activeTimelineTurnKey', () => {
  const positions = [
    { key: 'turn-1', top: -220 },
    { key: 'turn-2', top: 40 },
    { key: 'turn-3', top: 280 }
  ]

  it('keeps the latest turn that crossed the viewport threshold active', () => {
    expect(activeTimelineTurnKey(positions)).toBe('turn-2')
  })

  it('uses the first turn before any later turn crosses the threshold', () => {
    expect(activeTimelineTurnKey([
      { key: 'turn-1', top: 180 },
      { key: 'turn-2', top: 420 }
    ])).toBe('turn-1')
  })

  it('returns null for an empty timeline', () => {
    expect(activeTimelineTurnKey([])).toBeNull()
  })
})

describe('timelineJumpWaveDistance', () => {
  it('expands only the hovered turn and its nearby turns', () => {
    expect(Array.from({ length: 7 }, (_, index) => timelineJumpWaveDistance(index, 3))).toEqual([3, 2, 1, 0, 1, 2, 3])
  })

  it('keeps every turn compact when the rail is idle', () => {
    expect(timelineJumpWaveDistance(3, -1)).toBeNull()
  })
})

describe('timelineJumpPreviewMetadata', () => {
  it('collects unique edited file labels and detects a git commit command', () => {
    expect(timelineJumpPreviewMetadata({
      user: { kind: 'user', id: 'user-1', text: 'Update the rail' },
      blocks: [
        {
          kind: 'tool',
          id: 'file-1',
          summary: 'edit file',
          status: 'success',
          toolKind: 'file_change',
          filePath: '/workspace/src/base-shell.css'
        },
        {
          kind: 'tool',
          id: 'file-2',
          summary: 'edit file again',
          status: 'success',
          toolKind: 'file_change',
          filePath: 'src/base-shell.css'
        },
        {
          kind: 'tool',
          id: 'commit-1',
          summary: 'run command',
          status: 'success',
          toolKind: 'command_execution',
          meta: { command: 'git add src/base-shell.css && git commit -m "fix rail"' }
        }
      ]
    })).toEqual({ fileLabels: ['base-shell.css'], hasCommit: true })
  })

  it('ignores failed file changes and non-commit git commands', () => {
    expect(timelineJumpPreviewMetadata({
      blocks: [
        {
          kind: 'tool',
          id: 'file-failed',
          summary: 'edit file',
          status: 'error',
          toolKind: 'file_change',
          filePath: '/workspace/failed.ts'
        },
        {
          kind: 'tool',
          id: 'status-1',
          summary: 'run command',
          status: 'success',
          toolKind: 'command_execution',
          meta: { command: 'git status --short' }
        }
      ]
    })).toEqual({ fileLabels: [], hasCommit: false })
  })
})

describe('timelineJumpPreviewTop', () => {
  it('aligns the preview center with the hovered rail marker', () => {
    expect(timelineJumpPreviewTop(210, 20, 180)).toBe(40)
  })
})

describe('timelineJumpRailLeft', () => {
  it('anchors the rail to the left side of the conversation stage', () => {
    expect(timelineJumpRailLeft(1000)).toBe(16)
  })

  it('keeps the same left inset in wide conversation stages', () => {
    expect(timelineJumpRailLeft(1600)).toBe(16)
  })

  it('stays inside a very narrow chat stage', () => {
    expect(timelineJumpRailLeft(24)).toBe(0)
  })

  it('falls back to the stage inset when the width is not measurable yet', () => {
    expect(timelineJumpRailLeft(0)).toBe(16)
  })
})

describe('timelineJumpRailPreviewLeft', () => {
  it('keeps the hover preview inside the conversation gutter', () => {
    expect(timelineJumpRailPreviewLeft(-20, 520)).toBe(48)
  })

  it('keeps the hover preview inside the conversation right edge', () => {
    expect(timelineJumpRailPreviewLeft(1000, 1200)).toBe(768)
  })
})
