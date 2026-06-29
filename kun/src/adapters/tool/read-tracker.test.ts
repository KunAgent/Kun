import { describe, expect, it } from 'vitest'
import { ReadTracker, normalizeReadTrackerOptions } from './read-tracker.js'
import type { ToolHostContext, ToolCallLike } from '../../ports/tool-host.js'

function context(turnId: string, overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId,
    workspace: '/ws',
    approvalPolicy: 'never',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow' as const,
    ...overrides
  }
}

function readResult(turnId: string, path: string, content: string): {
  context: ToolHostContext
  call: ToolCallLike
  output: unknown
} {
  return {
    context: context(turnId),
    call: { callId: `read_${turnId}`, toolName: 'read', arguments: { path } },
    output: { path, relative_path: path, content, truncated: false }
  }
}

function editCall(path: string, oldText: string): ToolCallLike {
  return { callId: 'edit_1', toolName: 'edit', arguments: { path, oldText, newText: 'x' } }
}

describe('ReadTracker cross-turn edits (#640)', () => {
  it('allows an edit in a later turn when the oldText is still present in the cached read', () => {
    const tracker = new ReadTracker(normalizeReadTrackerOptions(true))
    tracker.observeToolResult(readResult('turn_a', 'file.ts', 'const value = 42\n'))

    // Edit arrives in a *different* turn than the read — the common case the
    // turnId guard used to reject, forcing a fallback to sed/bash.
    const verdict = tracker.validateBeforeTool({
      context: context('turn_b'),
      call: editCall('file.ts', 'const value = 42')
    })

    expect(verdict).toEqual({ ok: true })
  })

  it('still blocks an edit for a file that was never read', () => {
    const tracker = new ReadTracker(normalizeReadTrackerOptions(true))
    const verdict = tracker.validateBeforeTool({
      context: context('turn_b'),
      call: editCall('file.ts', 'const value = 42')
    })

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toContain('Read the current file contents')
  })

  it('still blocks a cross-turn edit when the oldText is not in the cached read', () => {
    const tracker = new ReadTracker(normalizeReadTrackerOptions(true))
    tracker.observeToolResult(readResult('turn_a', 'file.ts', 'const value = 42\n'))

    const verdict = tracker.validateBeforeTool({
      context: context('turn_b'),
      call: editCall('file.ts', 'const other = 99')
    })

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toContain('was not present in the latest read output')
  })

  it('allows a cross-turn multi-edit when every oldText fragment is present', () => {
    const tracker = new ReadTracker(normalizeReadTrackerOptions(true))
    tracker.observeToolResult(readResult('turn_a', 'file.ts', 'alpha\nbeta\ngamma\n'))

    const verdict = tracker.validateBeforeTool({
      context: context('turn_b'),
      call: {
        callId: 'edit_2',
        toolName: 'edit',
        arguments: { path: 'file.ts', edits: [{ oldText: 'alpha' }, { oldText: 'gamma' }] }
      }
    })

    expect(verdict).toEqual({ ok: true })
  })

  it('allows a cross-turn edit on a prior read when content checking is disabled', () => {
    const tracker = new ReadTracker(normalizeReadTrackerOptions({ enabled: true, requireOldTextInRead: false }))
    tracker.observeToolResult(readResult('turn_a', 'file.ts', 'const value = 42\n'))

    const verdict = tracker.validateBeforeTool({
      context: context('turn_b'),
      call: editCall('file.ts', 'anything at all')
    })

    expect(verdict).toEqual({ ok: true })
  })
})
