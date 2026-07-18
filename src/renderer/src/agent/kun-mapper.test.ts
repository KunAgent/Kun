import { describe, expect, it, vi } from 'vitest'
import {
  chatBlockFromItem,
  dispatchKunRuntimeEvent,
  mergeChatBlocks,
  runtimeProjectionActionsFromEvent
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

describe('runtime projection action normalization', () => {
  it('normalizes the same goal event to a stable action transcript', () => {
    const event: CoreRuntimeEventJson = {
      kind: 'goal_updated',
      seq: 9,
      timestamp: '2026-07-11T00:00:00.000Z',
      threadId: 'thread_1',
      goal: {
        threadId: 'thread_1',
        objective: 'Finish projection extraction',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z'
      }
    }

    const first = runtimeProjectionActionsFromEvent(event)
    const replay = runtimeProjectionActionsFromEvent(structuredClone(event))

    expect(replay).toEqual(first)
    expect(first).toEqual([{
      type: 'goal_changed',
      payload: {
        threadId: 'thread_1',
        goal: {
          threadId: 'thread_1',
          objective: 'Finish projection extraction',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        },
        createdAt: '2026-07-11T00:00:00.000Z'
      }
    }])
  })

  it('uses a deterministic fallback identity for legacy user-input events', () => {
    const actions = runtimeProjectionActionsFromEvent({
      kind: 'user_input_resolved',
      status: 'cancelled'
    })
    expect(actions).toEqual([{
      type: 'user_input_status_changed',
      payload: { itemId: 'input_unknown', status: 'cancelled' }
    }])
  })
})

describe('assistant stream mapping', () => {
  it('does not append completed assistant snapshots after streaming deltas', async () => {
    const deltas: unknown[] = []
    const sink: ThreadEventSink = {
      ...makeSink(),
      onDeltas: (events) => {
        deltas.push(...events)
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'assistant_text_delta',
      seq: 1,
      item: {
        id: 'item_answer',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'assistant',
        status: 'running',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'assistant_text',
        text: 'he'
      }
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'assistant_text_delta',
      seq: 2,
      item: {
        id: 'item_answer',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'assistant',
        status: 'running',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'assistant_text',
        text: 'llo'
      }
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'item_created',
      seq: 3,
      item: {
        id: 'item_answer',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'assistant',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'assistant_text',
        text: 'hello'
      }
    }, sink, async () => undefined)

    expect(deltas).toEqual([
      { text: 'he', kind: 'agent_message', seq: 1 },
      { text: 'llo', kind: 'agent_message', seq: 2 }
    ])
  })
})

describe('todo event mapping', () => {
  it('surfaces thread todo updates through the event sink', async () => {
    const events: unknown[] = []
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTodos: (event) => {
        events.push(event)
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'todos_updated',
      seq: 4,
      timestamp: '2026-06-04T00:00:00.000Z',
      threadId: 'thr_1',
      todos: {
        threadId: 'thr_1',
        updatedAt: '2026-06-04T00:00:00.000Z',
        items: [{
          id: 'todo_1',
          content: 'Wire todo panel',
          status: 'completed',
          createdAt: '2026-06-04T00:00:00.000Z',
          updatedAt: '2026-06-04T00:00:00.000Z'
        }]
      }
    }, sink, async () => undefined)

    expect(events).toEqual([{
      threadId: 'thr_1',
      createdAt: '2026-06-04T00:00:00.000Z',
      todos: {
        threadId: 'thr_1',
        updatedAt: '2026-06-04T00:00:00.000Z',
        items: [expect.objectContaining({ content: 'Wire todo panel', status: 'completed' })]
      }
    }])
  })
})

describe('review mapping', () => {
  const reviewItem: CoreTurnItemJson = {
    id: 'item_review_1',
    turnId: 'turn_1',
    threadId: 'thr_1',
    role: 'assistant',
    status: 'completed',
    createdAt: '2026-06-04T00:00:00.000Z',
    kind: 'review',
    title: 'Review current changes',
    target: { kind: 'uncommittedChanges' },
    reviewText: 'No review findings.',
    output: {
      findings: [],
      overallCorrectness: 'patch is correct',
      overallExplanation: 'No blocking issues found.',
      overallConfidenceScore: 0.75
    }
  }

  it('maps persisted review items to review blocks', () => {
    const block = chatBlockFromItem(reviewItem)
    expect(block).toMatchObject({
      kind: 'review',
      id: 'item_review_1',
      title: 'Review current changes',
      status: 'success',
      output: {
        overallCorrectness: 'patch is correct'
      }
    })
  })

  it('surfaces review item updates through the event sink', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onReview: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_updated',
      seq: 7,
      item: reviewItem
    }, sink, async () => undefined)

    expect(captured).toMatchObject({
      itemId: 'item_review_1',
      status: 'success',
      reviewText: 'No review findings.'
    })
  })
})

describe('create_plan tool mapping', () => {
  it('surfaces turn failure messages from Kun lifecycle events', async () => {
    let capturedError: string | null = null
    let capturedErrorOptions: ThreadErrorOptions | null = null
    let capturedRuntimeError: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeError: (event) => {
        capturedRuntimeError = event
      },
      onError: (error, options) => {
        capturedError = error.message
        capturedErrorOptions = options ?? null
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'turn_failed',
      seq: 8,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      message: 'model stream exploded'
    }, sink, async () => undefined)

    expect(capturedRuntimeError).toMatchObject({
      itemId: 'runtime_error_turn_1',
      message: 'model stream exploded',
      severity: 'error'
    })
    expect(JSON.parse(capturedError ?? '{}')).toMatchObject({
      message: 'model stream exploded',
      severity: 'error'
    })
    expect(capturedErrorOptions).toEqual({ terminal: true })
  })

  it('does not finish the parent turn for child lifecycle events', async () => {
    let completed = 0
    let fatalErrors = 0
    let childUpdate: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTurnComplete: () => {
        completed += 1
      },
      onTool: (event) => {
        childUpdate = event
      },
      onError: () => {
        fatalErrors += 1
      }
    }
    const child = {
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      childId: 'child_1',
      childLabel: 'child',
      childStatus: 'completed' as const,
      childSeq: 1,
      detached: true
    }

    await dispatchKunRuntimeEvent({
      kind: 'turn_started',
      seq: 8,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child: { ...child, childStatus: 'running' }
    }, sink, async () => undefined)
    expect(childUpdate).toMatchObject({
      status: 'running',
      updateOnly: true,
      meta: {
        child: {
          childId: 'child_1',
          childStatus: 'running',
          detached: true
        }
      }
    })

    await dispatchKunRuntimeEvent({
      kind: 'turn_completed',
      seq: 9,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'turn_aborted',
      seq: 10,
      timestamp: '2024-01-01T00:00:01.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child: { ...child, childStatus: 'aborted' }
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'turn_failed',
      seq: 11,
      timestamp: '2024-01-01T00:00:02.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child: { ...child, childStatus: 'failed' },
      message: 'child failed'
    }, sink, async () => undefined)

    expect(completed).toBe(0)
    expect(fatalErrors).toBe(0)
    expect(childUpdate).toMatchObject({
      status: 'error',
      updateOnly: true,
      meta: {
        child: {
          childId: 'child_1',
          childStatus: 'failed',
          detached: true
        }
      }
    })
  })

  it('keeps detached delegate_task results running until the child settles', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_completed',
      seq: 12,
      item: {
        id: 'item_delegate',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'tool_result',
        toolName: 'delegate_task',
        callId: 'call_delegate',
        output: {
          childId: 'child_background',
          status: 'queued',
          detached: true
        }
      }
    }, sink, async () => undefined)

    expect(captured).toMatchObject({
      itemId: 'tool_call_delegate',
      status: 'running'
    })
    expect(JSON.parse((captured as { detail: string }).detail)).toMatchObject({
      childId: 'child_background',
      status: 'queued',
      detached: true
    })
  })

  it('routes live error items to runtime error timeline events without fatal stream errors', async () => {
    let fatalCalled = false
    let capturedRuntimeError: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeError: (event) => {
        capturedRuntimeError = event
      },
      onError: () => {
        fatalCalled = true
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_created',
      seq: 9,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      item: {
        id: 'item_error_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'system',
        status: 'failed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'error',
        message: 'Authorization: Bearer secret-token failed',
        code: 'stream_read_error',
        details: { token: 'secret-token' }
      }
    }, sink, async () => undefined)

    expect(fatalCalled).toBe(false)
    expect(capturedRuntimeError).toMatchObject({
      itemId: 'item_error_1',
      message: 'Authorization=<redacted> failed',
      code: 'stream_read_error',
      details: { token: 'secret-token' }
    })
  })

  it('maps a successful create_plan result to a tool block with plan metadata', () => {
    const item: CoreTurnItemJson = {
      id: 'item_plan_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      finishedAt: '2024-01-01T00:00:01.000Z',
      kind: 'tool_result',
      toolName: 'create_plan',
      callId: 'call_plan_1',
      output: {
        plan_id: 'plan_login',
        workspace_root: '/tmp/ws',
        relative_path: '.deepseekgui/plan/login.md',
        absolute_path: '/tmp/ws/.deepseekgui/plan/login.md',
        operation: 'draft',
        saved_at: '2024-01-01T00:00:01.000Z',
        content_hash: 'deadbeefcafef00d',
        byte_size: 42,
        source_request: 'Add login',
        title: 'Login flow'
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.status).toBe('success')
      expect(block.meta?.toolName).toBe('create_plan')
      expect(block.meta?.plan).toMatchObject({
        plan_id: 'plan_login',
        workspace_root: '/tmp/ws',
        relative_path: '.deepseekgui/plan/login.md',
        operation: 'draft',
        byte_size: 42
      })
    }
  })

  it('maps a failed create_plan result to an error tool block', () => {
    const item: CoreTurnItemJson = {
      id: 'item_plan_err',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'failed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'create_plan',
      callId: 'call_plan_err',
      isError: true,
      output: { error: 'plan_relative_path must be a direct Markdown file under .deepseekgui/plan' }
    }
    const block = chatBlockFromItem(item)
    if (block && block.kind === 'tool') {
      expect(block.status).toBe('error')
      expect(block.meta?.plan).toMatchObject({ error: expect.stringContaining('direct Markdown') })
    } else {
      throw new Error('expected tool block')
    }
  })

  it('lifts tool_result output attachments into tool block meta', () => {
    const item: CoreTurnItemJson = {
      id: 'item_img_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'generate_image',
      callId: 'call_img_1',
      output: {
        files: [{ relativePath: '.deepseekgui-images/img-1.png' }],
        attachments: [
          { id: 'att_abc', name: 'img-1.png', mimeType: 'image/png', width: 1024, height: 576 },
          { id: '   ' },
          'not-an-object',
          { name: 'missing-id.png' }
        ],
        endpoint: 'generations'
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.attachments).toEqual([
        { id: 'att_abc', name: 'img-1.png', mimeType: 'image/png', width: 1024, height: 576 }
      ])
      expect(block.meta?.generatedFiles).toEqual([
        { relativePath: '.deepseekgui-images/img-1.png' }
      ])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('lifts generated speech files from tool_result output into tool block meta', () => {
    const item: CoreTurnItemJson = {
      id: 'item_speech_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'generate_speech',
      callId: 'call_speech_1',
      output: {
        files: [{
          relativePath: '.deepseekgui-audio/speech.mp3',
          absolutePath: '/tmp/project/.deepseekgui-audio/speech.mp3',
          mimeType: 'audio/mpeg',
          byteSize: 128
        }]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toEqual([{
        relativePath: '.deepseekgui-audio/speech.mp3',
        absolutePath: '/tmp/project/.deepseekgui-audio/speech.mp3',
        mimeType: 'audio/mpeg',
        byteSize: 128
      }])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('does not treat generic tool_result files as generated files', () => {
    const item: CoreTurnItemJson = {
      id: 'item_read_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'read',
      callId: 'call_read_1',
      output: {
        files: [
          { path: 'src/parser.js' },
          { path: 'src/admin_system.md' }
        ]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toBeUndefined()
    } else {
      throw new Error('expected tool block')
    }
  })

  it('still trusts explicit generatedFiles from tool_result output', () => {
    const item: CoreTurnItemJson = {
      id: 'item_export_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'export_report',
      callId: 'call_export_1',
      output: {
        files: [{ path: 'src/parser.js' }],
        generatedFiles: [{ relativePath: 'reports/summary.md', mimeType: 'text/markdown' }]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toEqual([
        { relativePath: 'reports/summary.md', mimeType: 'text/markdown' }
      ])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('projects top-level extension generatedArtifacts without paths or ephemeral URLs', () => {
    const item: CoreTurnItemJson = {
      id: 'item_artifact_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'video-render',
      callId: 'call_artifact_1',
      output: {
        content: { status: 'completed' },
        generatedArtifacts: [{
          schemaVersion: 1,
          artifactId: 'artifact_1234567890',
          mediaHandleId: 'media_123456789012',
          displayName: 'final.mp4',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          byteSize: 4096,
          durationMicros: 1_500_000,
          completionIdentity: 'identity_1234567890',
          availability: 'available',
          ownerExtensionId: 'kun.video-editor',
          ownerExtensionVersion: '1.0.0',
          workspaceId: 'workspace-1',
          provenance: { jobId: 'job_12345678', operation: 'video-render' }
        }]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toEqual([{
        id: 'artifact_1234567890',
        artifactId: 'artifact_1234567890',
        mediaHandleId: 'media_123456789012',
        availability: 'available',
        name: 'final.mp4',
        mimeType: 'video/mp4',
        byteSize: 4096,
        durationMicros: 1_500_000,
        mediaKind: 'video',
        completionIdentity: 'identity_1234567890',
        ownerExtensionId: 'kun.video-editor',
        ownerExtensionVersion: '1.0.0',
        workspaceId: 'workspace-1',
        provenance: { jobId: 'job_12345678', operation: 'video-render' }
      }])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('omits meta attachments when tool_result output has none worth showing', () => {
    const item: CoreTurnItemJson = {
      id: 'item_img_2',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'generate_image',
      callId: 'call_img_2',
      output: { attachments: 'nope' }
    }
    const block = chatBlockFromItem(item)
    if (block && block.kind === 'tool') {
      expect(block.meta?.attachments).toBeUndefined()
    } else {
      throw new Error('expected tool block')
    }
  })

  it('surfaces create_plan tool events through the event sink', () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }
    const event: CoreRuntimeEventJson = {
      kind: 'item_completed',
      seq: 5,
      item: {
        id: 'item_plan_sink',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'tool_result',
        toolName: 'create_plan',
        callId: 'call_plan_sink',
        output: {
          plan_id: 'plan_x',
          workspace_root: '/tmp/ws',
          relative_path: '.deepseekgui/plan/x.md',
          operation: 'refine',
          saved_at: '2024-01-01T00:00:01.000Z'
        }
      }
    }
    void dispatchKunRuntimeEvent(event, sink, async () => undefined)
    const capturedTool = captured as { meta?: { plan?: { plan_id?: string; operation?: string } } } | null
    expect(capturedTool).not.toBeNull()
    expect(capturedTool?.meta?.plan?.plan_id).toBe('plan_x')
    expect(capturedTool?.meta?.plan?.operation).toBe('refine')
  })
})

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

describe('streaming runtime status events', () => {
  it('surfaces tool-call ready events as running tool cards', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'tool_call_ready',
        seq: 20,
        itemId: 'item_tool_turn_1_call_read',
        callId: 'call_read',
        toolName: 'read',
        readyCount: 2
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      itemId: 'tool_call_read',
      summary: 'read',
      status: 'running',
      toolKind: 'tool_call',
      meta: {
        sourceItemId: 'item_tool_turn_1_call_read',
        callId: 'call_read',
        toolName: 'read',
        readyCount: 2,
        runtimeStatus: 'tool_call_ready'
      }
    })
  })

  it('surfaces tool-result upload waits as runtime status events', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeStatus: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'tool_result_upload_wait',
        seq: 21,
        timestamp: '2026-06-03T10:00:00.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        status: 'waiting',
        toolResultCount: 3
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      kind: 'tool_result_upload_wait',
      itemId: 'runtime_status_turn_1_tool_upload_wait',
      turnId: 'turn_1',
      createdAt: '2026-06-03T10:00:00.000Z',
      toolResultCount: 3
    })
  })

	  it('surfaces tool catalog drift as a runtime status event', async () => {
	    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeStatus: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'tool_catalog_changed',
        seq: 22,
        timestamp: '2026-06-03T10:00:01.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        fingerprint: 'fp_next',
        toolCount: 12,
        message: 'Tool catalog changed'
      },
      sink,
      async () => undefined
    )

	    expect(captured).toMatchObject({
	      kind: 'tool_catalog_changed',
	      itemId: 'runtime_status_tool_catalog_fp_next',
	      turnId: 'turn_1',
	      createdAt: '2026-06-03T10:00:01.000Z',
	      message: 'Tool catalog changed'
	    })
	  })

	  it('surfaces storm suppression as a runtime status event', async () => {
	    let captured: unknown = null
	    const sink: ThreadEventSink = {
	      ...makeSink(),
	      onRuntimeStatus: (event) => {
	        captured = event
	      }
	    }

	    await dispatchKunRuntimeEvent(
	      {
	        kind: 'tool_storm_suppressed',
	        seq: 23,
	        timestamp: '2026-06-03T10:00:02.000Z',
	        threadId: 'thr_1',
	        turnId: 'turn_1',
	        itemId: 'item_call_read_storm',
	        callId: 'call_read',
	        toolName: 'read',
	        message: 'read repeated the same arguments'
	      },
	      sink,
	      async () => undefined
	    )

	    expect(captured).toMatchObject({
	      kind: 'tool_storm_suppressed',
	      itemId: 'item_call_read_storm',
	      turnId: 'turn_1',
	      createdAt: '2026-06-03T10:00:02.000Z',
	      callId: 'call_read',
	      toolName: 'read',
	      message: 'read repeated the same arguments'
	    })
	  })

  it('surfaces model request retries as runtime status events', async () => {
    let captured: unknown = null
    const runtimeError = vi.fn()
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeStatus: (event) => {
        captured = event
      },
      onRuntimeError: runtimeError
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'model_request_retry',
        seq: 24,
        timestamp: '2026-06-03T10:00:03.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        status: 429,
        attempt: 1,
        maxAttempts: 3,
        delayMs: 3000
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      kind: 'model_request_retry',
      itemId: 'runtime_status_turn_1_model_retry',
      turnId: 'turn_1',
      createdAt: '2026-06-03T10:00:03.000Z',
      status: 429,
      attempt: 1,
      maxAttempts: 3,
      delayMs: 3000
    })
    expect(runtimeError).not.toHaveBeenCalled()
  })
	})

describe('Kun extension metadata mapping', () => {
  it('maps turn disclosure metadata onto user messages', () => {
    const block = chatBlockFromItem({
      id: 'item_user_meta',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'user',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'look at this',
      displayText: 'Inspect attached image',
      guiDesignCanvas: true,
      guiDesignMode: false,
      attachmentIds: ['att_1'],
      fileReferences: [{
        path: '/workspace/deepseek-gui/src/App.tsx',
        relativePath: 'src/App.tsx',
        name: 'App.tsx',
        kind: 'file'
      }],
      activeSkillIds: ['skill_review'],
      injectedMemoryIds: ['mem_1'],
      skillInjectionBytes: 128
    })
    expect(block).toMatchObject({
      kind: 'user',
      meta: {
        displayText: 'Inspect attached image',
        guiDesignCanvas: true,
        attachmentIds: ['att_1'],
        fileReferences: [{
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx',
          kind: 'file'
        }],
        activeSkillIds: ['skill_review'],
        injectedMemoryIds: ['mem_1'],
        skillInjectionBytes: 128
      }
    })
  })

  it('surfaces web citations and child metadata through tool events', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'item_completed',
        seq: 12,
        child: {
          parentThreadId: 'thr_1',
          parentTurnId: 'turn_1',
          childId: 'child_research',
          childLabel: 'research',
          childStatus: 'completed',
          childSeq: 2
        },
        item: {
          id: 'item_web',
          turnId: 'turn_1',
          threadId: 'thr_1',
          role: 'tool',
          status: 'completed',
          createdAt: '2024-01-01T00:00:00.000Z',
          kind: 'tool_result',
          toolName: 'web_search',
          callId: 'call_web',
          output: {
            query: 'kun mcp',
            sources: [
              {
                sourceId: 'src_1',
                title: 'Docs',
                url: 'https://example.com/docs',
                retrievedAt: '2024-01-01T00:00:00.000Z'
              }
            ]
          }
        }
      },
      sink,
      async () => undefined
    )
    expect(captured).toMatchObject({
      meta: {
        child: { childId: 'child_research', childLabel: 'research' },
        sources: [{ title: 'Docs', url: 'https://example.com/docs' }]
      }
    })
  })

  it('preserves background subagent message source on user messages', () => {
    const block = chatBlockFromItem({
      id: 'item_subagent_notice',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'user',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: '<background_subagent_completed><child_id>child-1</child_id><label>后台休眠</label><status>completed</status><summary>done</summary></background_subagent_completed>',
      displayText: 'Background subagent 后台休眠 completed',
      messageSource: 'background_subagent'
    })

    expect(block).toMatchObject({
      kind: 'user',
      meta: {
        displayText: 'Background subagent 后台休眠 completed',
        messageSource: 'background_subagent'
      }
    })
  })
})

describe('usage event mapping', () => {
  it('does not infer cache hit rate from cachedTokens-only usage events', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUsage: (usage) => {
        captured = usage
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'usage',
        seq: 12,
        usage: {
          promptTokens: 100,
          completionTokens: 5,
          totalTokens: 105,
          cachedTokens: 42,
          turns: 1
        }
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
      cachedTokens: 0,
      cacheMissTokens: 0,
      cacheHitRate: null,
      turns: 1
    })
  })

  it('derives cache hit rate only from explicit hit and miss usage counters', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUsage: (usage) => {
        captured = usage
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'usage',
        seq: 13,
        usage: {
          promptTokens: 100,
          completionTokens: 5,
          totalTokens: 105,
          cacheHitTokens: 80,
          cacheMissTokens: 20,
          tokenEconomySavingsTokens: 4096,
          turns: 1
        }
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
      cachedTokens: 80,
      cacheMissTokens: 20,
      cacheHitRate: 0.8,
      tokenEconomySavingsTokens: 4096,
      turns: 1
    })
  })
})

describe('tool presentation inference', () => {
  it('prefers explicit toolKind from Kun over local heuristics', () => {
    const block = chatBlockFromItem({
      id: 'item_explicit_kind',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'custom_tool',
      toolKind: 'command_execution',
      callId: 'call_explicit',
      output: { path: '/tmp/should-not-force-file-kind', command: 'echo hi' }
    })
    expect(block).toMatchObject({
      kind: 'tool',
      toolKind: 'command_execution',
      meta: { command: 'echo hi' }
    })
  })

  it('uses the explicit command_execution kind and preserves the command string', () => {
    const block = chatBlockFromItem({
      id: 'item_shell',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_call',
      toolName: 'shell',
      toolKind: 'command_execution',
      callId: 'call_shell',
      arguments: { command: 'npm test' }
    })
    expect(block).toMatchObject({
      kind: 'tool',
      toolKind: 'command_execution',
      meta: { command: 'npm test', toolName: 'shell' }
    })
  })

  it('surfaces bash session metadata on command blocks', () => {
    const block = chatBlockFromItem({
      id: 'item_bash_session',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'bash',
      toolKind: 'command_execution',
      callId: 'call_bash',
      output: {
        command: 'npm run dev',
        session_id: 'bash_abc123',
        status: 'running',
        pid: 1234,
        shell: 'bash',
        cwd: '/tmp/app'
      }
    })
    expect(block).toMatchObject({
      kind: 'tool',
      toolKind: 'command_execution',
      meta: {
        command: 'npm run dev',
        session_id: 'bash_abc123',
        status: 'running',
        pid: 1234,
        shell: 'bash',
        cwd: '/tmp/app'
      }
    })
  })

  it('uses the explicit file_change kind and surfaces the path', () => {
    const block = chatBlockFromItem({
      id: 'item_file',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'write_file',
      toolKind: 'file_change',
      callId: 'call_file',
      output: { path: '/tmp/demo.ts', bytes_written: 12 }
    })
    expect(block).toMatchObject({
      kind: 'tool',
      toolKind: 'file_change',
      filePath: '/tmp/demo.ts'
    })
  })

  it('surfaces final output and destination path aliases for generated artifacts', () => {
    const ppt = chatBlockFromItem({
      id: 'item_ppt',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'ppt_master_run',
      toolKind: 'file_change',
      callId: 'call_ppt',
      output: {
        output_path: '/tmp/presentations/brief.pptx',
        generatedFiles: [{
          relativePath: 'presentations/brief.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        }]
      }
    })
    const htmlCopy = chatBlockFromItem({
      id: 'item_html_copy',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: presentationStudioModelAlias('presentation-export-copy'),
      toolKind: 'file_change',
      callId: 'call_html_copy',
      output: {
        content: {
          sourcePath: 'brief.kun-ppt.html',
          destinationPath: 'brief-copy.kun-ppt.html',
          contentSha256: 'a'.repeat(64)
        },
        summary: 'Exported copy'
      }
    })

    expect(ppt).toMatchObject({
      filePath: '/tmp/presentations/brief.pptx',
      meta: {
        generatedFiles: [{
          relativePath: 'presentations/brief.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        }]
      }
    })
    expect(htmlCopy).toMatchObject({
      filePath: 'brief-copy.kun-ppt.html',
      meta: {
        canonicalToolId: presentationStudioCanonicalToolId('presentation-export-copy'),
        presentationArtifactProducer: PRESENTATION_STUDIO_EXTENSION_ID,
        presentationArtifactSha256: 'a'.repeat(64)
      }
    })
  })

  it('unwraps progressive extension gateway presentation writes with trusted provenance', () => {
    const block = chatBlockFromItem({
      id: 'item_gateway_html',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'extension_tool_call',
      toolKind: 'tool_call',
      callId: 'call_gateway_html',
      output: {
        canonicalToolId: presentationStudioCanonicalToolId('presentation-apply'),
        result: {
          content: {
            path: 'brief.kun-ppt.html',
            resultingRevision: 2,
            contentSha256: 'b'.repeat(64)
          },
          summary: 'Applied operations'
        }
      }
    })

    expect(block).toMatchObject({
      toolKind: 'file_change',
      filePath: 'brief.kun-ppt.html',
      meta: {
        canonicalToolId: presentationStudioCanonicalToolId('presentation-apply'),
        presentationArtifactProducer: PRESENTATION_STUDIO_EXTENSION_ID,
        presentationArtifactSha256: 'b'.repeat(64)
      }
    })
  })

  it('preserves workspace-write semantics from a generic progressive extension gateway', () => {
    const block = chatBlockFromItem({
      id: 'item_gateway_ppt',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'extension_tool_call',
      toolKind: 'tool_call',
      callId: 'call_gateway_ppt',
      output: {
        canonicalToolId: 'extension:example.exporter/export-ppt',
        sideEffect: 'workspace-write',
        result: { content: { destinationPath: 'presentations/brief.pptx' } }
      }
    })

    expect(block).toMatchObject({
      toolKind: 'file_change',
      filePath: 'presentations/brief.pptx'
    })
  })

  it('classifies built-in write/edit tools as file_change by name when toolKind is omitted', () => {
    const block = chatBlockFromItem({
      id: 'item_write_builtin',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'write',
      callId: 'call_write',
      output: { path: '/tmp/demo.ts', bytes_written: 12 }
    })
    expect(block).toMatchObject({
      kind: 'tool',
      toolKind: 'file_change',
      filePath: '/tmp/demo.ts'
    })
  })

  it('classifies built-in bash by name as command_execution when toolKind is omitted', () => {
    const block = chatBlockFromItem({
      id: 'item_bash_builtin',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'bash',
      callId: 'call_bash',
      output: { command: 'pwd', output: '/tmp' }
    })
    expect(block).toMatchObject({
      kind: 'tool',
      toolKind: 'command_execution',
      meta: { command: 'pwd', toolName: 'bash' }
    })
  })

  it('falls back to payload shape when legacy items omit toolKind', () => {
    const block = chatBlockFromItem({
      id: 'item_legacy',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'future_tool',
      callId: 'call_legacy',
      output: { command: 'npm test', path: '/tmp/demo.ts' }
    })
    expect(block).toMatchObject({
      kind: 'tool',
      toolKind: 'command_execution',
      meta: { command: 'npm test' }
    })
  })

  it('keeps validated extension composer metadata on persisted user blocks', () => {
    const composerContext = {
      schemaVersion: 1 as const,
      id: 'video-selection',
      title: 'Interview selection',
      summary: 'Revision 4 with one selected clip',
      reference: { projectId: 'project-1', selectedItemIds: ['clip-1'] },
      revision: 4,
      generation: 7,
      attachmentId: `extension-context:${'a'.repeat(64)}`,
      provenance: {
        extensionId: 'acme.video-editor',
        extensionVersion: '1.1.0',
        viewContributionId: 'extension:acme.video-editor/editor',
        workspaceId: 'b'.repeat(64)
      }
    }
    const block = chatBlockFromItem({
      id: 'item-user-context',
      turnId: 'turn-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'completed',
      createdAt: '2026-07-14T00:00:00.000Z',
      kind: 'user_message',
      text: 'Use the selection',
      composerContexts: [composerContext]
    })
    expect(block).toMatchObject({
      kind: 'user',
      meta: { composerContexts: [composerContext] }
    })
  })
})
