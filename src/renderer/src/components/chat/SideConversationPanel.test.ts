import { createElement } from 'react'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import type { SideConversation } from '../../store/chat-store-types'
import {
  activeSideConversationOrdinal,
  SideConversationPanel
} from './SideConversationPanel'
import { FloatingComposer } from './FloatingComposer'

const firstSide: SideConversation = {
  threadId: 'side-1',
  parentThreadId: 'main-1',
  title: 'Parent · side',
  createdAt: '2026-07-23T00:22:00.000Z',
  inheritedAt: '2026-07-23T00:22:00.000Z',
  blocks: [
    {
      kind: 'user',
      id: 'side-user',
      turnId: 'side-turn',
      text: 'What did I just ask?',
      modelLabel: 'gpt-5.6'
    },
    {
      kind: 'reasoning',
      id: 'side-reasoning',
      text: 'internal reasoning that stays in the process section'
    },
    {
      kind: 'assistant',
      id: 'side-assistant',
      turnId: 'side-turn',
      text: 'You asked for three subagents to greet you.'
    }
  ],
  liveReasoning: '',
  liveAssistant: '',
  lastSeq: 4,
  input: 'independent branch draft',
  model: 'gpt-5.6',
  providerId: 'codex',
  reasoningEffort: 'low',
  fastMode: false,
  attachments: [],
  busy: false,
  turnId: null,
  userItemId: null,
  error: null
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === 'string' ? child : textContent(child))
    .join('')
}

describe('SideConversationPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    ;(globalThis as { window?: unknown }).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      setInterval,
      clearInterval,
      innerHeight: 900,
      innerWidth: 1400,
      kunGui: {
        platform: 'darwin',
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{"sessions":[]}' }))
      }
    }
    useChatStore.setState({
      activeThreadId: 'main-1',
      threads: [{
        id: 'main-1',
        title: 'Parent conversation',
        updatedAt: '2026-07-23T00:22:00.000Z',
        model: 'gpt-5.6',
        mode: 'agent',
        status: 'idle'
      }],
      workspaceRoot: '/workspace',
      runtimeConnection: 'ready',
      busy: false,
      composerModel: 'gpt-5.6',
      composerProviderId: 'codex',
      composerPickList: ['gpt-5.6'],
      composerModelGroups: [],
      composerReasoningEffort: 'low',
      composerFastMode: false,
      sideConversations: { [firstSide.threadId]: firstSide },
      sidePanel: { open: true, activeSideId: firstSide.threadId }
    })
  })

  it('uses the shared main timeline and composer inside the docked branch workspace', () => {
    let renderer: ReactTestRenderer | undefined
    act(() => {
      renderer = create(createElement(SideConversationPanel, { variant: 'docked' }))
    })

    const root = renderer!.root
    const content = textContent(root)
    expect(root.findByProps({ 'aria-label': 'Switch branch conversation' }).props.title)
      .toContain('From “Parent conversation”')
    expect(root.findAllByProps({ 'data-testid': 'side-conversation-timeline' })).toHaveLength(1)
    expect(root.findAll((node) =>
      typeof node.props.className === 'string' && node.props.className.includes('ds-user-message-bubble')
    )).toHaveLength(1)
    expect(content).toContain('What did I just ask?')
    expect(content).toContain('You asked for three subagents to greet you.')
    expect(root.findAll((node) =>
      typeof node.props.className === 'string' && node.props.className.includes('ds-composer-shell')
    )).toHaveLength(1)
    expect(root.findByProps({ value: 'independent branch draft' })).toBeDefined()
    expect(content).not.toContain('Fork response')
    expect(root.findAllByProps({ 'aria-label': 'Edit & resend' })).toHaveLength(0)

    act(() => renderer!.unmount())
  })

  it('derives stable one-based branch ordinals for tab titles', () => {
    const secondSide = { ...firstSide, threadId: 'side-2' }
    expect(activeSideConversationOrdinal([firstSide, secondSide], 'side-1')).toBe(1)
    expect(activeSideConversationOrdinal([firstSide, secondSide], 'side-2')).toBe(2)
    expect(activeSideConversationOrdinal([firstSide, secondSide], null)).toBe(3)
  })

  it('keeps provider and model changes local to the active branch conversation', () => {
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SideConversationPanel, { variant: 'docked' }))
    })

    const composer = renderer!.root.findByType(FloatingComposer)
    expect(composer.props.composerProviderId).toBe('codex')

    act(() => {
      composer.props.onComposerModelChange('composer-2.5', 'cursor-subscription')
    })

    expect(useChatStore.getState().sideConversations['side-1']).toMatchObject({
      model: 'composer-2.5',
      providerId: 'cursor-subscription'
    })
    expect(useChatStore.getState().composerModel).toBe('gpt-5.6')
    expect(useChatStore.getState().composerProviderId).toBe('codex')

    act(() => renderer!.unmount())
  })

  it('shows Fast mode for an eligible Codex model and keeps it local to the branch', () => {
    useChatStore.setState({
      composerModelGroups: [{
        providerId: 'codex',
        presetSource: 'codex',
        label: 'ChatGPT subscription',
        modelIds: ['gpt-5.6'],
        modelProfiles: {
          'gpt-5.6': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text'],
            serviceTiers: ['priority']
          }
        }
      }]
    })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SideConversationPanel, { variant: 'docked' }))
    })

    const composer = renderer!.root.findByType(FloatingComposer)
    expect(composer.props.composerFastMode).toBe(false)
    const fastButton = renderer!.root.findByProps({ 'aria-label': 'Fast mode off' })

    act(() => {
      fastButton.props.onClick()
    })

    expect(useChatStore.getState().sideConversations['side-1'].fastMode).toBe(true)
    expect(useChatStore.getState().composerFastMode).toBe(false)

    act(() => renderer!.unmount())
  })

  it('uploads, previews, and removes a pasted image only in the active branch', async () => {
    const uploadRuntimeImageAttachment = vi.fn(async () => ({
      ok: true as const,
      attachment: {
        id: 'att-side-image',
        name: 'clipboard.webp',
        kind: 'image' as const,
        mimeType: 'image/webp',
        byteSize: 3,
        width: 4,
        height: 5,
        hash: 'hash',
        threadIds: ['side-1'],
        workspaces: ['/workspace'],
        createdAt: 't0',
        updatedAt: 't0'
      },
      preview: {
        dataBase64: 'AQID',
        mimeType: 'image/webp',
        byteSize: 3,
        width: 4,
        height: 5
      },
      compression: { sourceBytes: 3, outputBytes: 3, fallbackBytes: 3, wasCompressed: false }
    }))
    Object.assign(globalThis.window.kunGui, { uploadRuntimeImageAttachment })
    useChatStore.setState({
      composerModelGroups: [{
        providerId: 'codex',
        presetSource: 'codex',
        label: 'ChatGPT subscription',
        modelIds: ['gpt-5.6'],
        modelProfiles: {
          'gpt-5.6': {
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url']
          }
        }
      }]
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SideConversationPanel, {
        variant: 'docked',
        attachmentStoreAvailable: true
      }))
    })

    let composer = renderer!.root.findByType(FloatingComposer)
    expect(composer.props.attachmentUploadEnabled).toBe(true)
    await act(async () => {
      await composer.props.onPasteClipboardImage()
    })

    expect(uploadRuntimeImageAttachment).toHaveBeenCalledWith({
      source: { kind: 'clipboard' },
      threadId: 'side-1'
    })
    expect(useChatStore.getState().sideConversations['side-1'].attachments).toEqual([
      expect.objectContaining({
        id: 'att-side-image',
        previewUrl: 'data:image/webp;base64,AQID'
      })
    ])

    composer = renderer!.root.findByType(FloatingComposer)
    act(() => composer.props.onRemoveAttachment('att-side-image'))
    expect(useChatStore.getState().sideConversations['side-1'].attachments).toEqual([])

    act(() => renderer!.unmount())
  })

  it('uploads pasted text only to the active branch without requiring image support', async () => {
const uploadRuntimeDocumentAttachment = vi.fn(async (request: { temporaryText: string; name: string; threadId: string }) => ({
ok: true as const,
attachment: {
id: 'att-side-text', name: request.name, kind: 'document' as const, mimeType: 'text/plain',
byteSize: request.temporaryText.length, hash: 'hash', documentFormat: 'text' as const,
threadIds: [request.threadId], workspaces: ['/workspace'], createdAt: 't0', updatedAt: 't0'
}
}))
Object.assign(globalThis.window.kunGui, { uploadRuntimeDocumentAttachment })
let renderer: ReactTestRenderer
await act(async () => {
renderer = create(createElement(SideConversationPanel, {
variant: 'docked', attachmentStoreAvailable: true
}))
})

const composer = renderer!.root.findByType(FloatingComposer)
const text = 'x'.repeat(10_001)
await act(async () => {
await composer.props.onPasteLongText(text)
})
expect(uploadRuntimeDocumentAttachment).toHaveBeenCalledWith(expect.objectContaining({
temporaryText: text,
threadId: 'side-1'
}))
expect(useChatStore.getState().sideConversations['side-1'].attachments).toEqual([
expect.objectContaining({
id: 'att-side-text', kind: 'document', documentFormat: 'text'
})
])
expect(useChatStore.getState().sideConversations['side-1'].attachments[0]).not.toHaveProperty('documentText')
act(() => renderer!.unmount())
})

it('passes draft images to branch creation without changing main attachments', async () => {
    const spawnSideConversation = vi.fn(async () => 'side-new')
    const uploadRuntimeImageAttachment = vi.fn(async () => ({
      ok: true as const,
      attachment: {
        id: 'att-draft-image',
        name: 'clipboard.webp',
        kind: 'image' as const,
        mimeType: 'image/webp',
        byteSize: 3,
        width: 4,
        height: 5,
        hash: 'hash',
        threadIds: [],
        workspaces: ['/workspace'],
        createdAt: 't0',
        updatedAt: 't0'
      },
      preview: { dataBase64: 'AQID', mimeType: 'image/webp', byteSize: 3, width: 4, height: 5 },
      compression: { sourceBytes: 3, outputBytes: 3, fallbackBytes: 3, wasCompressed: false }
    }))
    Object.assign(globalThis.window.kunGui, { uploadRuntimeImageAttachment })
    useChatStore.setState({
      sidePanel: { open: true, activeSideId: null },
      spawnSideConversation,
      composerModelGroups: [{
        providerId: 'codex',
        label: 'Codex',
        modelIds: ['gpt-5.6'],
        modelProfiles: {
          'gpt-5.6': {
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url']
          }
        }
      }]
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SideConversationPanel, {
        variant: 'docked',
        attachmentStoreAvailable: true
      }))
    })

    let composer = renderer!.root.findByType(FloatingComposer)
    await act(async () => {
      await composer.props.onPasteClipboardImage()
    })
    composer = renderer!.root.findByType(FloatingComposer)
    act(() => composer.props.setInput('inspect draft'))
    composer = renderer!.root.findByType(FloatingComposer)
    await act(async () => {
      composer.props.onSend()
      await Promise.resolve()
    })

    expect(uploadRuntimeImageAttachment).toHaveBeenCalledWith({
      source: { kind: 'clipboard' },
      workspace: '/workspace'
    })
    expect(spawnSideConversation).toHaveBeenCalledWith(
      'inspect draft',
      expect.objectContaining({
        attachments: [expect.objectContaining({ id: 'att-draft-image' })]
      })
    )
    expect(useChatStore.getState().queuedMessages).toEqual([])

    act(() => renderer!.unmount())
  })

  it('does not upload images for a text-only branch model', async () => {
    const uploadRuntimeImageAttachment = vi.fn()
    Object.assign(globalThis.window.kunGui, { uploadRuntimeImageAttachment })
    useChatStore.setState({
      composerModelGroups: [{
        providerId: 'codex',
        label: 'Codex',
        modelIds: ['gpt-5.6'],
        modelProfiles: {
          'gpt-5.6': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      }]
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SideConversationPanel, {
        variant: 'docked',
        attachmentStoreAvailable: true
      }))
    })

    const composer = renderer!.root.findByType(FloatingComposer)
    await act(async () => {
      await composer.props.onPasteClipboardImage()
    })

    expect(uploadRuntimeImageAttachment).not.toHaveBeenCalled()
    expect(renderer!.root.findByType(FloatingComposer).props.attachmentUploadError)
      .toBe(i18n.t('composerAttachmentModelUnsupported'))

    act(() => renderer!.unmount())
  })

  it('renders and submits live structured input inside the side composer', async () => {
    const originalResolveSideUserInput = useChatStore.getState().resolveSideUserInput
    const resolveSideUserInput = vi.fn(async () => undefined)
    const sideWithInput: SideConversation = {
      ...firstSide,
      busy: true,
      blocks: [
        ...firstSide.blocks,
        {
          kind: 'user_input',
          id: 'side-input-item',
          requestId: 'side-input-request',
          status: 'pending',
          live: true,
          questions: [{
            id: 'scope',
            header: 'Scope',
            question: 'Where should this be available?',
            options: [
              { label: 'Side only', description: 'Keep it in this branch.' },
              { label: 'Everywhere', description: 'Share it with the main conversation.' }
            ]
          }]
        }
      ]
    }
    useChatStore.setState({
      sideConversations: { [sideWithInput.threadId]: sideWithInput },
      resolveSideUserInput
    })

    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(createElement(SideConversationPanel, { variant: 'docked' }))
      })

      expect(renderer!.root.findByProps({
        'data-user-input-variant': 'compact'
      })).toBeDefined()

      const option = renderer!.root.findAllByType('button').find((button) =>
        textContent(button).includes('Side only')
      )
      expect(option).toBeDefined()
      await act(async () => {
        option!.props.onClick()
      })

      const submit = renderer!.root.findAllByType('button').find((button) =>
        textContent(button).includes('Submit answers')
      )
      expect(submit).toBeDefined()
      await act(async () => {
        submit!.props.onClick()
      })

      expect(resolveSideUserInput).toHaveBeenCalledWith(
        'side-1',
        'side-input-item',
        {
          kind: 'submit',
          answers: [{ id: 'scope', label: 'Side only', value: 'Side only' }]
        }
      )
    } finally {
      const mountedRenderer = renderer
      if (mountedRenderer) {
        act(() => mountedRenderer.unmount())
      }
      useChatStore.setState({ resolveSideUserInput: originalResolveSideUserInput })
    }
  })

  it('can return from a new-branch draft to the only existing branch', () => {
    useChatStore.setState({ sidePanel: { open: true, activeSideId: null } })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SideConversationPanel, { variant: 'docked' }))
    })

    const switcher = renderer!.root.findByProps({ 'aria-label': 'Switch branch conversation' })
    expect(switcher.props.disabled).toBe(false)
    act(() => switcher.props.onClick())

    const branchOption = renderer!.root.findAllByType('button').find((button) =>
      textContent(button).includes('Branch conversation 1')
    )
    expect(branchOption).toBeDefined()
    act(() => branchOption!.props.onClick())
    expect(useChatStore.getState().sidePanel.activeSideId).toBe('side-1')

    act(() => renderer!.unmount())
  })
})
