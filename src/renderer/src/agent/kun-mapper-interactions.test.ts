import { describe, expect, it, vi } from 'vitest'
import {
  chatBlockFromItem,
  dispatchKunRuntimeEvent,
  dispatchKunRuntimeEvents,
  mergeChatBlocks,
  runtimeProjectionActionsFromEvent,
  threadFromCore
} from './kun-mapper'
import type { CoreRuntimeEventJson, CoreTurnItemJson } from './kun-contract'
import type { ThreadErrorOptions, ThreadEventSink } from './types'
import {
  PRESENTATION_STUDIO_EXTENSION_ID,
  presentationStudioCanonicalToolId,
  presentationStudioModelAlias
} from '@shared/presentation-artifact'

function makeSink(): ThreadEventSink {
  return {
    onSeq: () => undefined,
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: () => undefined,
    onUserInput: () => undefined,
    onUserInputStatus: () => undefined,
    onGoal: () => undefined,
    onTodos: () => undefined,
    onTurnComplete: () => undefined,
    onError: () => undefined
  }
}

describe('component prototype mapping', () => {
  const item = (status: 'preparing' | 'running' | 'completed' | 'failed'): CoreTurnItemJson => ({
    id: `item_component_${status}`,
    turnId: 'turn_component',
    threadId: 'thread_component',
    role: 'tool',
    status: 'completed',
    createdAt: '2026-07-16T00:00:00.000Z',
    kind: 'tool_result',
    toolName: 'design_component',
    callId: 'call_component',
    output: {
      status,
      componentPrototype: {
        version: 1,
        status,
        artifactId: 'component_abcdef1234',
        title: 'Date range picker',
        relativePath: '.kun-design/component-prototypes/date-range/prototype.html',
        viewport: { width: 720, height: 460 },
        profile: 'component-designer',
        childId: 'child_component',
        byteSize: 4096,
        contentHash: 'a'.repeat(64),
        summary: 'Added range preview.'
      }
    }
  })

  it('maps preparing and running payloads to a running inline artifact', () => {
    for (const status of ['preparing', 'running'] as const) {
      expect(chatBlockFromItem(item(status))).toMatchObject({
        kind: 'tool',
        status: 'running',
        meta: {
          toolName: 'design_component',
          componentPrototype: {
            version: 1,
            status,
            artifactId: 'component_abcdef1234',
            relativePath: '.kun-design/component-prototypes/date-range/prototype.html',
            viewport: { width: 720, height: 460 },
            producer: 'component-designer',
            profile: 'component-designer'
          }
        }
      })
    }
  })

  it('maps completed and failed prototype status independently of the generic item status', () => {
    expect(chatBlockFromItem(item('completed'))).toMatchObject({ kind: 'tool', status: 'success' })
    expect(chatBlockFromItem(item('failed'))).toMatchObject({ kind: 'tool', status: 'error' })
  })

  it('maps direct main-agent prototypes without child metadata', () => {
    const direct = item('completed')
    const prototype = (direct.output as Record<string, unknown>).componentPrototype as Record<string, unknown>
    delete prototype.profile
    delete prototype.childId
    prototype.producer = 'main-agent'

    expect(chatBlockFromItem(direct)).toMatchObject({
      kind: 'tool',
      status: 'success',
      meta: {
        componentPrototype: {
          producer: 'main-agent',
          status: 'completed'
        }
      }
    })
  })

  it('keeps historical component-designer payloads compatible when producer is absent', () => {
    const legacy = item('completed')
    const prototype = (legacy.output as Record<string, unknown>).componentPrototype as Record<string, unknown>
    delete prototype.producer

    expect(chatBlockFromItem(legacy)).toMatchObject({
      kind: 'tool',
      meta: {
        componentPrototype: {
          producer: 'component-designer',
          profile: 'component-designer'
        }
      }
    })
  })

  it('surfaces the same structured card metadata through a live SSE item update', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_updated',
      seq: 18,
      item: item('running')
    }, sink, async () => undefined)

    expect(captured).toMatchObject({
      itemId: 'tool_call_component',
      status: 'running',
      meta: {
        toolName: 'design_component',
        componentPrototype: {
          status: 'running',
          relativePath: '.kun-design/component-prototypes/date-range/prototype.html'
        }
      }
    })
  })

  it('drops unsafe or malformed prototype paths instead of surfacing a webview', () => {
    const unsafe = item('completed')
    ;((unsafe.output as Record<string, unknown>).componentPrototype as Record<string, unknown>).relativePath =
      '../outside/prototype.html'
    const block = chatBlockFromItem(unsafe)
    expect(block).toMatchObject({ kind: 'tool' })
    if (block?.kind === 'tool') expect(block.meta?.componentPrototype).toBeUndefined()
  })
})

describe('user input mapping', () => {
  it('maps structured user-input items without inventing submit-only options', () => {
    const item: CoreTurnItemJson = {
      id: 'item_input_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'pending',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_input',
      inputId: 'input_1',
      prompt: 'Pick one',
      questions: [
        {
          header: 'Decision',
          id: 'choice',
          question: 'Pick one',
          options: [
            { label: 'Yes', description: 'Continue' },
            { label: 'No', description: 'Stop' }
          ]
        }
      ]
    }
    const block = chatBlockFromItem(item)
    expect(block).toMatchObject({
      kind: 'user_input',
      questions: [
        {
          header: 'Decision',
          id: 'choice',
          question: 'Pick one',
          options: [
            { label: 'Yes', description: 'Continue' },
            { label: 'No', description: 'Stop' }
          ]
        }
      ]
    })
  })

  it('maps multi-select questions and submitted answers from user-input items', () => {
    const item: CoreTurnItemJson = {
      id: 'item_input_multi',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'submitted',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_input',
      inputId: 'input_multi',
      prompt: 'Pick requirements',
      questions: [
        {
          header: 'Requirements',
          id: 'reqs',
          question: 'Pick requirements',
          selectionMode: 'multiple',
          minSelections: 2,
          maxSelections: 3,
          options: [
            { label: 'Keep ratio', description: '' },
            { label: 'App icon', description: '' }
          ]
        }
      ],
      answers: [
        {
          id: 'reqs',
          label: 'Keep ratio, App icon',
          value: 'Keep ratio, App icon',
          labels: ['Keep ratio', 'App icon'],
          values: ['Keep ratio', 'App icon']
        }
      ]
    }
    expect(chatBlockFromItem(item)).toMatchObject({
      kind: 'user_input',
      status: 'submitted',
      questions: [
        {
          id: 'reqs',
          selectionMode: 'multiple',
          minSelections: 2,
          maxSelections: 3
        }
      ],
      answers: [
        {
          id: 'reqs',
          values: ['Keep ratio', 'App icon']
        }
      ]
    })
  })

  it('surfaces structured user-input requests from runtime events', async () => {
    let request: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUserInput: (payload) => {
        request = payload
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'user_input_requested',
        seq: 7,
        itemId: 'item_input_2',
        inputId: 'input_2',
        prompt: 'Choose',
        questions: [
          {
            header: 'Mode',
            id: 'mode',
            question: 'Choose',
            options: [{ label: 'Fast', description: 'Use the faster path' }]
          }
        ]
      },
      sink,
      async () => undefined
    )
    expect(request).toMatchObject({
      itemId: 'item_input_2',
      requestId: 'input_2',
      questions: [
        {
          header: 'Mode',
          id: 'mode',
          question: 'Choose',
          options: [{ label: 'Fast', description: 'Use the faster path' }]
        }
      ]
    })
  })

  it('maps timeoutSeconds from runtime events and timeout resolutions', async () => {
    let request: unknown = null
    let status: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUserInput: (payload) => {
        request = payload
      },
      onUserInputStatus: (payload) => {
        status = payload
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'user_input_requested',
        seq: 21,
        itemId: 'item_input_timeout',
        inputId: 'input_timeout',
        prompt: 'Choose',
        timeoutSeconds: 45,
        questions: [
          { header: 'Mode', id: 'mode', question: 'Choose', options: [] }
        ]
      },
      sink,
      async () => undefined
    )
    expect(request).toMatchObject({ timeoutSeconds: 45 })

    await dispatchKunRuntimeEvent(
      {
        kind: 'user_input_resolved',
        seq: 22,
        itemId: 'item_input_timeout',
        inputId: 'input_timeout',
        status: 'timeout'
      },
      sink,
      async () => undefined
    )
    expect(status).toMatchObject({ itemId: 'item_input_timeout', status: 'timeout' })
  })

  it('maps prompt/message aliases on user-input questions', async () => {
    let request: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUserInput: (payload) => {
        request = payload
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'user_input_requested',
        seq: 8,
        itemId: 'item_input_alias',
        inputId: 'input_alias',
        questions: [
          {
            id: 'next_action',
            prompt: 'Release review finished. What should I do next?',
            options: [{ label: 'Fix blockers', description: '' }]
          }
        ]
      },
      sink,
      async () => undefined
    )
    expect(request).toMatchObject({
      itemId: 'item_input_alias',
      requestId: 'input_alias',
      questions: [
        {
          id: 'next_action',
          question: 'Release review finished. What should I do next?',
          options: [{ label: 'Fix blockers', description: '' }]
        }
      ]
    })
  })

  it('drops empty user-input requests instead of inventing placeholder text', async () => {
    let request: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUserInput: (payload) => {
        request = payload
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'user_input_requested',
        seq: 9,
        itemId: 'item_input_empty',
        inputId: 'input_empty',
        questions: [{ id: 'blank', options: [{ label: 'Continue', description: '' }] }]
      },
      sink,
      async () => undefined
    )
    expect(request).toBeNull()
    expect(
      chatBlockFromItem({
        id: 'item_input_empty',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'user_input',
        inputId: 'input_empty',
        questions: [{ id: 'blank', options: [{ label: 'Continue', description: '' }] }]
      })
    ).toBeNull()
  })

  it('surfaces submitted user-input answers from runtime events', async () => {
    let status: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUserInputStatus: (payload) => {
        status = payload
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'user_input_resolved',
        seq: 9,
        itemId: 'item_input_3',
        inputId: 'input_3',
        status: 'submitted',
        answers: [
          {
            id: 'reqs',
            label: 'Keep ratio, App icon',
            value: 'Keep ratio, App icon',
            labels: ['Keep ratio', 'App icon'],
            values: ['Keep ratio', 'App icon']
          }
        ]
      },
      sink,
      async () => undefined
    )
    expect(status).toMatchObject({
      itemId: 'item_input_3',
      status: 'submitted',
      answers: [
        {
          id: 'reqs',
          values: ['Keep ratio', 'App icon']
        }
      ]
    })
  })

  it('does not emit duplicate user-input cards from generic item events', async () => {
    let called = false
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUserInput: () => {
        called = true
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'item_created',
        seq: 8,
        item: {
          id: 'item_input_dup',
          turnId: 'turn_1',
          threadId: 'thr_1',
          role: 'tool',
          status: 'pending',
          createdAt: '2024-01-01T00:00:00.000Z',
          kind: 'user_input',
          inputId: 'input_dup',
          prompt: 'Choose'
        }
      },
      sink,
      async () => undefined
    )
    expect(called).toBe(false)
  })
})

describe('approval mapping', () => {
  it('does not emit duplicate approval cards from generic item events', async () => {
    let called = false
    const sink: ThreadEventSink = {
      ...makeSink(),
      onApproval: () => {
        called = true
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'item_created',
        seq: 9,
        item: {
          id: 'item_approval_dup',
          turnId: 'turn_1',
          threadId: 'thr_1',
          role: 'tool',
          status: 'pending',
          createdAt: '2024-01-01T00:00:00.000Z',
          kind: 'approval',
          approvalId: 'appr_1',
          toolName: 'shell',
          summary: 'Approval required'
        }
      },
      sink,
      async () => undefined
    )
    expect(called).toBe(false)
  })

  it('rehydrates expired approval items as non-actionable blocks', () => {
    expect(chatBlockFromItem({
      id: 'item_approval_expired',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'expired',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'approval',
      approvalId: 'appr_expired',
      toolName: 'shell',
      summary: 'Approval required'
    })).toMatchObject({
      kind: 'approval',
      approvalId: 'appr_expired',
      status: 'expired'
    })
  })

  it('maps live approval resolution events to status updates', async () => {
    const onApprovalStatus = vi.fn()
    await dispatchKunRuntimeEvent(
      {
        kind: 'approval_resolved',
        seq: 10,
        approvalId: 'appr_expired',
        status: 'expired',
        reason: 'turn aborted while awaiting approval'
      },
      { ...makeSink(), onApprovalStatus },
      async () => undefined
    )

    expect(onApprovalStatus).toHaveBeenCalledWith({
      approvalId: 'appr_expired',
      status: 'expired',
      errorMessage: 'turn aborted while awaiting approval'
    })
  })
})

describe('tool block merging', () => {
  it('coalesces repeated hydrated assistant and reasoning item snapshots by identity', () => {
    const blocks = mergeChatBlocks([
      { kind: 'assistant', id: 'item_answer', turnId: 'turn_1', text: 'partial answer' },
      { kind: 'reasoning', id: 'item_think', turnId: 'turn_1', text: 'first thought' },
      { kind: 'assistant', id: 'item_answer', turnId: 'turn_1', text: 'complete answer' },
      { kind: 'reasoning', id: 'item_think', turnId: 'turn_1', text: 'complete thought' }
    ])

    expect(blocks).toEqual([
      { kind: 'assistant', id: 'item_answer', turnId: 'turn_1', text: 'complete answer' },
      { kind: 'reasoning', id: 'item_think', turnId: 'turn_1', text: 'complete thought' }
    ])
  })

  it('coalesces tool_call and tool_result items for the same call id into one block', () => {
    const blocks = mergeChatBlocks([
      chatBlockFromItem({
        id: 'item_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'tool_call',
        toolName: 'echo',
        callId: 'call_1',
        arguments: { text: 'hi' }
      })!,
      chatBlockFromItem({
        id: 'item_result',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'completed',
        createdAt: '2024-01-01T00:00:01.000Z',
        kind: 'tool_result',
        toolName: 'echo',
        callId: 'call_1',
        output: { echoed: 'hi' }
      })!
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_call_1',
      status: 'success',
      meta: {
        sourceItemKind: 'tool_result'
      }
    })
  })
})
