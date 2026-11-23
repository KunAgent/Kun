import { describe, expect, test } from 'vitest'
import {
  MODEL_REQUEST_TRACE_SCHEMA_VERSION,
  ModelRequestTraceRecordSchema
} from './model-request-trace.js'

function record(delegated: unknown): Record<string, unknown> {
  return {
    schemaVersion: MODEL_REQUEST_TRACE_SCHEMA_VERSION,
    id: 'trace_1',
    sequence: 1,
    threadId: 'thread_1',
    turnId: 'turn_1',
    provider: 'claude-subscription',
    model: 'claude-sonnet-4-5',
    transport: 'sdk',
    endpointFormat: 'agent-sdk',
    attempt: 1,
    attemptReason: 'initial',
    status: 'completed',
    startedAt: '2026-07-25T00:00:00.000Z',
    request: {
      method: 'SDK',
      url: 'agent-sdk://local/query',
      urlRedacted: false,
      headers: { values: {}, redactedNames: [] },
      body: {
        text: '{"input":"hello"}',
        capturedBytes: 17,
        originalBytes: 17,
        truncated: false
      }
    },
    delegated
  }
}

describe('delegated model request trace contract', () => {
  test('preserves workspace-root rebases emitted by delegated session routing', () => {
    const value = ModelRequestTraceRecordSchema.parse(record({
      providerKind: 'codex-app-server', phase: 'rebased', reason: 'workspace_roots_changed',
      contextManagement: 'sdk-managed', nativeHistory: 'none', capabilities: {
        nativeResume: true, structuredStreaming: true, kunTools: true, externalApproval: true,
        liveSteering: false, nativeContextTelemetry: false, fork: false
      }
    }))
    expect(value.delegated?.reason).toBe('workspace_roots_changed')
  })
  test('accepts the bounded non-secret delegated envelope', () => {
    expect(ModelRequestTraceRecordSchema.parse(record({
      providerKind: 'agent-sdk',
      phase: 'resumed',
      contextManagement: 'sdk-managed',
      nativeHistory: 'unknown',
      capabilities: {
        nativeResume: true,
        structuredStreaming: true,
        kunTools: true,
        externalApproval: true,
        liveSteering: false,
        nativeContextTelemetry: false,
        fork: false
      }
    })).delegated).toMatchObject({
      providerKind: 'agent-sdk',
      phase: 'resumed',
      nativeHistory: 'unknown'
    })
  })

  test('rejects raw native identifiers and incomplete capabilities', () => {
    const parsed = ModelRequestTraceRecordSchema.parse(record({
      providerKind: 'cursor-sdk',
      phase: 'rebased',
      reason: 'native_state_unavailable',
      contextManagement: 'sdk-managed',
      nativeHistory: 'none',
      nativeSessionId: 'must-not-survive',
      capabilities: {
        nativeResume: true,
        structuredStreaming: true,
        kunTools: false,
        externalApproval: false,
        liveSteering: false,
        nativeContextTelemetry: false,
        fork: false
      }
    }))
    expect(parsed.delegated).not.toHaveProperty('nativeSessionId')
    expect(() => ModelRequestTraceRecordSchema.parse(record({
      providerKind: 'agent-sdk',
      phase: 'resumed',
      contextManagement: 'sdk-managed',
      nativeHistory: 'unknown',
      capabilities: { nativeResume: true }
    }))).toThrow()
  })
})
