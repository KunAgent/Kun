import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { SddAssistantPanel } from './SddAssistantPanel'

describe('SddAssistantPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useChatStore.setState({
      activeThreadId: 'thr_sdd',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace',
      threads: []
    })
  })

  it('shows separate reasoning and Fast controls for eligible Codex models', () => {
    const html = renderToStaticMarkup(createElement(SddAssistantPanel, {
      draft: {
        id: 'draft-1',
        workspaceRoot: '/workspace',
        relativePath: '.kunsdd/requirements/draft-1/requirement.md',
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:00:00.000Z'
      },
      input: '',
      setInput: () => undefined,
      mode: 'agent',
      setMode: () => undefined,
      busy: false,
      runtimeConnection: 'ready',
      activeThreadId: 'thr_sdd',
      blocks: [],
      liveReasoning: '',
      liveAssistant: '',
      composerModel: 'gpt-5.6-sol',
      composerProviderId: 'codex',
      composerPickList: ['gpt-5.6-sol'],
      composerModelGroups: [{
        providerId: 'codex',
        presetSource: 'codex',
        label: 'Codex',
        modelIds: ['gpt-5.6-sol'],
        modelProfiles: {
          'gpt-5.6-sol': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text'],
            reasoning: {
              supportedEfforts: ['off', 'low', 'medium', 'high', 'max'],
              defaultEffort: 'high',
              requestProtocol: 'openai-responses'
            },
            serviceTiers: ['priority']
          }
        }
      }],
      composerReasoningEffort: 'high',
      composerFastMode: true,
      setComposerModel: () => undefined,
      setComposerReasoningEffort: () => undefined,
      setComposerFastMode: () => undefined,
      queuedMessages: [],
      removeQueuedMessage: () => undefined,
      guideQueuedMessage: () => undefined,
      onSend: () => undefined,
      onInterrupt: () => undefined,
      onRetryConnection: () => undefined,
      onOpenSettings: () => undefined,
      onNewConversation: () => undefined,
      onApplyFramework: () => undefined,
      onCollapse: () => undefined
    }))

    expect(html).toContain('aria-label="Model: Codex / gpt-5.6-sol"')
    expect(html).toContain('aria-label="Reasoning: High"')
    expect(html).toContain('aria-label="Fast mode on"')
  })
})
