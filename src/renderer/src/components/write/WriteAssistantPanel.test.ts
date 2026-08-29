import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { WriteAssistantPanel } from './WriteAssistantPanel'

describe('WriteAssistantPanel', () => {
  it('forwards enabled runtime Skills to the compact composer', () => {
    useChatStore.setState({
      activeThreadId: 'thr_write',
      activeThreadGoal: null,
      route: 'write',
      workspaceRoot: '/workspace',
      threads: []
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/draft.md'
    })

    const html = renderToStaticMarkup(createElement(WriteAssistantPanel, {
      input: '/style',
      setInput: () => undefined,
      mode: 'agent',
      setMode: () => undefined,
      busy: false,
      runtimeConnection: 'ready',
      activeThreadId: 'thr_write',
      blocks: [],
      liveReasoning: '',
      liveAssistant: '',
      composerModel: '',
      composerPickList: [],
      composerReasoningEffort: 'max',
      composerFastMode: false,
      setComposerModel: () => undefined,
      setComposerReasoningEffort: () => undefined,
      setComposerFastMode: () => undefined,
      queuedMessages: [],
      removeQueuedMessage: () => undefined,
      guideQueuedMessage: () => undefined,
      skillCommands: [
        {
          id: 'style-guide',
          name: 'Style Guide',
          description: 'Apply the project writing style',
          root: '/workspace/.codex/skills/style-guide',
          scope: 'project',
          legacy: true,
          version: '1',
          triggers: { commands: [], fileTypes: [], promptPatterns: [] },
          allowedTools: []
        },
        {
          id: 'disabled-skill',
          name: 'Disabled Skill',
          root: '/workspace/.codex/skills/disabled-skill',
          scope: 'project',
          legacy: true,
          version: '1',
          triggers: { commands: [], fileTypes: [], promptPatterns: [] },
          allowedTools: []
        }
      ],
      disabledSkillIds: ['disabled-skill'],
      onSend: () => undefined,
      onInterrupt: () => undefined,
      onRetryConnection: () => undefined,
      onOpenSettings: () => undefined,
      onNewConversation: () => undefined,
      onPickWorkspace: () => undefined,
      onCollapse: () => undefined
    }))

    expect(html).toContain('Style Guide')
    expect(html).toContain('/skill:style-guide')
    expect(html).not.toContain('Disabled Skill')
    expect(html).toContain('write-assistant-ready')
    expect(html.match(/write-assistant-action-row/g)).toHaveLength(3)
    expect(html).toContain('Current file')
  })

  it('exposes queued plain-text messages from the collapsed queue', () => {
    useChatStore.setState({
      activeThreadId: 'thr_write',
      activeThreadGoal: null,
      route: 'write',
      workspaceRoot: '/workspace',
      threads: []
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/draft.md'
    })

    const html = renderToStaticMarkup(createElement(WriteAssistantPanel, {
      input: '',
      setInput: () => undefined,
      mode: 'agent',
      setMode: () => undefined,
      busy: true,
      runtimeConnection: 'ready',
      activeThreadId: 'thr_write',
      blocks: [],
      liveReasoning: '',
      liveAssistant: '',
      composerModel: '',
      composerPickList: [],
      composerReasoningEffort: 'max',
      composerFastMode: false,
      setComposerModel: () => undefined,
      setComposerReasoningEffort: () => undefined,
      setComposerFastMode: () => undefined,
      queuedMessages: [{ id: 'q-guide', text: 'keep the opening shorter' }],
      removeQueuedMessage: () => undefined,
      guideQueuedMessage: () => undefined,
      onSend: () => undefined,
      onInterrupt: () => undefined,
      onRetryConnection: () => undefined,
      onOpenSettings: () => undefined,
      onNewConversation: () => undefined,
      onPickWorkspace: () => undefined,
      onCollapse: () => undefined
    }))

    expect(html).toContain('aria-label="1 queued"')
  })

  it('shows separate reasoning and Fast controls for Codex models', () => {
    useChatStore.setState({
      activeThreadId: 'thr_write',
      activeThreadGoal: null,
      route: 'write',
      workspaceRoot: '/workspace',
      threads: []
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: '/workspace/draft.md'
    })

    const html = renderToStaticMarkup(createElement(WriteAssistantPanel, {
      input: '',
      setInput: () => undefined,
      mode: 'agent',
      setMode: () => undefined,
      busy: false,
      runtimeConnection: 'ready',
      activeThreadId: 'thr_write',
      blocks: [],
      liveReasoning: '',
      liveAssistant: '',
      composerModel: 'gpt-5.4',
      composerProviderId: 'codex',
      composerPickList: ['gpt-5.4'],
      composerModelGroups: [{
        providerId: 'codex',
        presetSource: 'codex',
        label: 'Codex',
        modelIds: ['gpt-5.4'],
        modelProfiles: {
          'gpt-5.4': {
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
      onPickWorkspace: () => undefined,
      onCollapse: () => undefined
    }))

    expect(html).toContain('Codex · gpt-5.4')
    expect(html).toContain('aria-label="Reasoning: High"')
    expect(html).toContain('aria-label="Fast mode on"')
  })

})
