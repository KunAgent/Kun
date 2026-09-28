import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'

describe('ADE harness desktop HTTP boundary', () => {
  it.each([
    ['/v1/harnesses', ['GET']],
    ['/v1/harnesses?wait_ms=3000', ['GET']],
    ['/v1/harnesses/claude-code/models', ['GET']],
    ['/v1/harnesses/claude-code/models?credential_mode=kun-gateway', ['GET']],
    ['/v1/harnesses/claude-code/probe', ['POST']],
    ['/v1/activity?scope=workspace&workspace=%2Ftmp%2Frepo', ['GET']],
    ['/v1/activity/events?cursor=5&wait_ms=30000', ['GET']],
    ['/v1/activity/foreground', ['POST']],
    ['/v1/activity/unit-1/ack', ['POST']],
    ['/v1/activity/unit-1/dismiss', ['POST']],
    ['/v1/activity/unit-1/pin', ['POST']],
    ['/v1/approvals?thread_id=thread-1', ['GET']],
    ['/v1/task-workspaces?thread_id=thread-1', ['GET', 'POST']],
    ['/v1/task-workspaces/ws-1', ['GET']],
    ['/v1/task-workspaces/preserved-branches?repo=%2Ftmp%2Frepo', ['GET']],
    ['/v1/task-workspaces/ws-1/diff', ['GET']],
    ['/v1/task-workspaces/ws-1/diff/file?path=a.ts', ['GET']],
    ['/v1/task-workspaces/ws-1/attribution', ['GET']],
    ['/v1/task-workspaces/ws-1/integrate-preview', ['GET']],
    ['/v1/task-workspaces/ws-1/change-request', ['GET', 'POST']],
    ['/v1/task-workspaces/ws-1/integrate', ['POST']],
    ['/v1/task-workspaces/ws-1/discard', ['POST']],
    ['/v1/task-workspaces/ws-1/cleanup', ['POST']],
    ['/v1/reviews/ws-1/comments', ['GET', 'POST']],
    ['/v1/reviews/ws-1/comments/comment-1', ['PATCH']],
    ['/v1/reviews/ws-1/send', ['POST']],
    ['/v1/teams/by-manager/thread-1', ['GET']],
    ['/v1/teams/questions/q-1/answer', ['POST']],
    ['/v1/teams/workers/worker-1', ['GET']],
    ['/v1/teams/workers/worker-1/stop', ['POST']],
    ['/v1/teams/workers/worker-1/run-checks', ['POST']],
    ['/v1/teams/races/race-1', ['GET']],
    ['/v1/teams/races/race-1/decide', ['POST']],
    ['/v1/teams/races/race-1/discard-others', ['POST']]
  ])('allows modeled methods for %s', (path, methods) => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(methods.includes(method))
    }
  })
  it.each([
    '/v1/harnesses/claude-code',
    '/v1/harnesses/claude-code/probe/extra',
    '/v1/harnesses//probe',
    '/v1/harnesses/claude-code/models/extra',
    '/v1/approvals/approval-1',
    '/v1/task-workspaces/ws-1/unknown-action',
    '/v1/teams/workers//stop',
    '/v1/reviews//comments',
    '/v1/teams'
  ])('rejects unmodeled paths and empty identities: %s', (path) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'GET' }).success).toBe(false)
  })
  it.each(['/v1/activity', '/v1/activity/events', '/v1/approvals'])(
    'rejects writes on read-only feed endpoints: %s', (path) => {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(false)
    }
  )
})
