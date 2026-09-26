import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { DesignDrawingStart } from './DesignDrawingStart'

type DesignDrawingStartProps = ComponentProps<typeof DesignDrawingStart>

function props(overrides: Partial<DesignDrawingStartProps> = {}): DesignDrawingStartProps {
  return {
    leftSidebarCollapsed: false,
    onToggleLeftSidebar: () => {},
    workspaceRoot: '/tmp/kun-design',
    input: '',
    setInput: () => {},
    mode: 'agent',
    setMode: () => {},
    busy: false,
    runtimeConnection: 'ready',
    composerModel: 'gpt-5.6-luna',
    composerProviderId: 'codex',
    composerPickList: ['gpt-5.6-luna'],
    composerModelGroups: [{
      providerId: 'codex',
      label: 'Codex',
      modelIds: ['gpt-5.6-luna'],
      modelProfiles: {
        'gpt-5.6-luna': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text'],
          serviceTiers: ['priority']
        }
      }
    }],
    composerReasoningEffort: 'high',
    composerFastMode: true,
    setComposerModel: () => {},
    setComposerReasoningEffort: () => {},
    setComposerFastMode: () => {},
    queuedMessages: [],
    removeQueuedMessage: () => {},
    guideQueuedMessage: () => {},
    onSend: () => {},
    onInterrupt: () => {},
    ...overrides
  }
}

beforeEach(() => {
  useDesignWorkspaceStore.setState({
    designContext: { designTarget: 'web' },
    multiPageMode: false,
    drawingCreationSubmitting: false
  })
})

describe('DesignDrawingStart', () => {
  it('shows separate Codex model, reasoning, and Fast controls', () => {
    const html = renderToStaticMarkup(createElement(DesignDrawingStart, props()))

    expect(html).toContain('data-design-start-composer="true"')
    expect(html).toContain('Codex · gpt-5.6-luna')
    expect(html).toContain('aria-label="Reasoning: High"')
    expect(html).toContain('aria-label="Fast mode on"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('opens a blank Excalidraw drawing without the HTML composer', () => {
    const html = renderToStaticMarkup(createElement(DesignDrawingStart, props()))
    expect(html).toContain('data-canvas-engine-switcher="true"')
    expect(html).toContain('data-design-start-composer="true"')
    expect(html).not.toContain('data-design-excalidraw-open="true"')
  })
})
