import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomIntegration, RoomTask } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomTaskGates, roomInputAnswers } from './RoomTaskGates'
import { RoomRuleTaskUpdate } from './RoomRuleTaskUpdate'
import { RoomIntegrationPanel } from './RoomIntegrationPanel'
import { roomTaskActions } from './RoomTaskPanel'
import type { RoomTaskDetail } from './rooms-client'

const api = vi.hoisted(() => ({
  request: vi.fn(),
  snapshots: new Map<string, unknown>(),
  refresh: vi.fn(async () => undefined)
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: api.request
}))
vi.mock('./useRoomResource', async (original) => ({
  ...(await original<typeof import('./useRoomResource')>()),
  useRoomResource: (_room: string, path: string | null) => ({
    data: path ? (api.snapshots.get(path) ?? null) : null,
    error: '',
    refresh: api.refresh
  })
}))

const task = {
  id: 'task',
  roomId: 'room',
  revision: 8,
  latestDeliveryId: 'delivery',
  status: 'awaiting_acceptance',
  applicationStatus: 'not_applied',
  stage: 'develop'
} as RoomTask
const base = '/v1/rooms/room/tasks/task'

describe('Room product interactions', () => {
  let renderer: ReactTestRenderer
  const protectedApproval = vi.fn()
  const confirm = vi.fn()
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.request.mockReset().mockResolvedValue({})
    api.snapshots.clear()
    api.refresh.mockClear()
    protectedApproval.mockReset().mockResolvedValue({
      confirmed: true,
      response: { ok: true, body: '{}' }
    })
    confirm.mockReset().mockResolvedValue(true)
    vi.stubGlobal('window', {
      kunGui: { resolveKunApproval: protectedApproval, confirmDialog: confirm }
    })
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.unstubAllGlobals()
  })
  const button = (text: string) =>
    renderer.root
      .findAllByType('button')
      .find((item) => item.children.includes(text))!
  const renderGates = async (
    detail: Partial<RoomTaskDetail> = {},
    value = task
  ) => {
    await act(async () => {
      renderer = create(
        createElement(RoomTaskGates, {
          task: value,
          detail: { task: value, reviews: [], ...detail },
          onUpdated: api.refresh
        })
      )
    })
  }
  it('submits approval through the protected user bridge, never raw HTTP', async () => {
    await renderGates({
      approvals: [{ id: 'approval', toolName: 'exec', summary: 'Run tests' }]
    })
    await act(async () => button('Review and allow').props.onClick({ isTrusted: true }))
    expect(protectedApproval).toHaveBeenCalledWith({
      approvalId: 'approval',
      decision: 'allow',
      source: 'user', presentation: 'room'
    })
    expect(api.request).not.toHaveBeenCalled()
  })
  it('preserves structured multiple-choice answers and submits the native input endpoint', async () => {
    const input = {
      id: 'input',
      prompt: 'Choose platforms',
      questions: [
        {
          id: 'platform',
          question: 'Platforms?',
          selectionMode: 'multiple' as const,
          options: [
            { label: 'macOS', description: '' },
            { label: 'Linux', description: '' }
          ],
          minSelections: 2
        }
      ]
    }
    expect(
      roomInputAnswers(input, { platform: ['macOS', 'Linux'] }, {})
    ).toEqual([
      {
        id: 'platform',
        label: 'macOS, Linux',
        value: 'macOS\nLinux',
        labels: ['macOS', 'Linux'],
        values: ['macOS', 'Linux']
      }
    ])
    await renderGates({ userInputs: [input] })
    expect(button('Submit answers').props.disabled).toBe(true)
    act(() => {
      for (const checkbox of renderer.root.findAllByProps({ type: 'checkbox' }))
        checkbox.props.onChange({ target: { checked: true } })
    })
    await act(async () =>
      renderer.root
        .findByType('form')
        .props.onSubmit({ preventDefault: () => undefined })
    )
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/input', 'POST', {
      answers: [
        {
          id: 'platform',
          label: 'macOS, Linux',
          value: 'macOS\nLinux',
          labels: ['macOS', 'Linux'],
          values: ['macOS', 'Linux']
        }
      ]
    })
  })
  it('does not expose a retry that bypasses unknown execution recovery', () => {
    expect(
      roomTaskActions({ ...task, status: 'recovery_required' })
    ).not.toContain('retry')
    expect(
      roomTaskActions({ ...task, status: 'failed', stage: 'review' })
    ).toContain('retry-review')
  })
  it('disables recovery replay and abandonment until the runtime proves execution stopped', async () => {
    api.snapshots.set(base + '/recovery', {
      state: 'unknown',
      reason: 'Unknown executor',
      canRetry: false,
      canAbandon: false
    })
    await renderGates({}, { ...task, status: 'recovery_required' })
    expect(button('Retry task').props.disabled).toBe(true)
    expect(button('Abandon delivery').props.disabled).toBe(true)
    await act(async () => button('Check original execution').props.onClick())
    expect(api.request).toHaveBeenCalledWith(
      base + '/recover',
      'POST',
      expect.objectContaining({ action: 'reconcile', expectedRevision: 8 })
    )
  })
  it('requires explicit confirmation before applying an unverified integration and preserves retry identity', async () => {
    const integration = {
      id: 'candidate',
      status: 'ready',
      deliveryId: 'delivery',
      revision: 3,
      createdAt: '2026-09-12T00:00:00Z',
      targetSha: '1234',
      sourceSha: '2345',
      candidateSha: '3456',
      path: '/tmp/integration',
      conflicts: [],
      validation: [],
      diff: ''
    } as unknown as RoomIntegration
    api.snapshots.set(base + '/integrations?summary_only=true', { integrations: [integration] })
    await act(async () => {
      renderer = create(
        createElement(RoomIntegrationPanel, {
          task,
          onUpdated: api.refresh,
          onOpenThread: vi.fn()
        })
      )
    })
    expect(button('Apply integration candidate').props.disabled).toBe(true)
    act(() =>
      renderer.root
        .findByProps({ type: 'checkbox' })
        .props.onChange({ target: { checked: true } })
    )
    api.request.mockRejectedValue(new Error('Connection interrupted'))
    await act(async () => button('Apply integration candidate').props.onClick())
    expect(api.request).toHaveBeenLastCalledWith(
      base + '/integrations/candidate/apply',
      'POST',
      expect.objectContaining({ expectedRevision: 3, confirmUnverified: true })
    )
    const requestId = api.request.mock.calls[0][2].clientRequestId
    await act(async () => button('Apply integration candidate').props.onClick())
    expect(api.request.mock.calls[1][2].clientRequestId).toBe(requestId)
  })
  it('adopts an exact rule version through the trusted task snapshot endpoint', async () => {
    api.snapshots.set(
      '/v1/rooms/room/tasks?limit=200&status=running,needs_input,needs_approval,queued,waiting_dependency',
      {
        tasks: [
          {
            ...task,
            title: 'Active task',
            memberSnapshot: { displayName: 'Developer' }
          }
        ]
      }
    )
    await act(async () => {
      renderer = create(
        createElement(RoomRuleTaskUpdate, {
          roomId: 'room',
          rule: {
            id: 'rule',
            version: 3,
            revision: 4,
            body: 'Use tests',
            messageId: 'message'
          },
          onUpdated: api.refresh
        })
      )
    })
    act(() => button('Notify active tasks').props.onClick())
    act(() =>
      renderer.root
        .findByProps({ type: 'checkbox' })
        .props.onChange({ target: { checked: true } })
    )
    await act(async () => button('Send agreement update').props.onClick())
    expect(api.request).toHaveBeenCalledWith(
      '/v1/rooms/room/rules/rule/adopt',
      'POST',
      expect.objectContaining({
        taskId: 'task',
        expectedTaskRevision: 8,
        version: 3,
        body: expect.stringContaining('Use tests')
      })
    )
  })

  it('resolves integration gates using integration execution IDs', async () => {
    api.snapshots.set(base + '/integrations?summary_only=true', {
      integrations: [
        {
          id: 'candidate',
          status: 'validating',
          deliveryId: 'delivery',
          revision: 3,
          createdAt: '2026-09-12T00:00:00Z',
          targetSha: '1234',
          sourceSha: '2345',
          path: '/tmp/integration',
          conflicts: [],
          validation: [],
          diff: '',
          approvals: [
            {
              id: 'integration-approval',
              toolName: 'exec',
              summary: 'Integration validation'
            }
          ],
          userInputs: [
            {
              id: 'integration-input',
              prompt: 'Integration choice',
              questions: [
                {
                  id: 'choice',
                  question: 'Proceed?',
                  options: [{ label: 'Yes', description: '' }]
                }
              ]
            }
          ]
        }
      ]
    })
    await act(async () => {
      renderer = create(
        createElement(RoomIntegrationPanel, {
          task,
          onUpdated: api.refresh,
          onOpenThread: vi.fn()
        })
      )
    })
    await act(async () => button('Review and allow').props.onClick({ isTrusted: true }))
    expect(protectedApproval).toHaveBeenCalledWith({
      approvalId: 'integration-approval',
      decision: 'allow',
      source: 'user', presentation: 'room'
    })
    act(() =>
      renderer.root
        .findByProps({ type: 'radio' })
        .props.onChange({ target: { checked: true } })
    )
    await act(async () =>
      renderer.root
        .findByType('form')
        .props.onSubmit({ preventDefault: () => undefined })
    )
    expect(api.request).toHaveBeenCalledWith(
      '/v1/user-inputs/integration-input',
      'POST',
      { answers: [{ id: 'choice', label: 'Yes', value: 'Yes' }] }
    )
  })

  it('never deletes a task directory until cleanup preview and explicit confirmation both allow it', async () => {
    api.snapshots.set(base + '/integrations?summary_only=true', { integrations: [] })
    api.snapshots.set(base + '/cleanup', {
      eligible: true,
      revision: 8,
      token: 'a'.repeat(64),
      paths: [{ path: '/tmp/task', bytes: 1024 }]
    })
    await act(async () => {
      renderer = create(
        createElement(RoomIntegrationPanel, {
          task,
          onUpdated: api.refresh,
          onOpenThread: vi.fn()
        })
      )
    })
    act(() => button('Review disk usage and cleanup').props.onClick())
    confirm.mockResolvedValue(false)
    await act(async () => button('Clean up directories').props.onClick())
    expect(api.request).not.toHaveBeenCalled()
    confirm.mockResolvedValue(true)
    await act(async () => button('Clean up directories').props.onClick())
    expect(api.request).toHaveBeenCalledWith(
      base + '/cleanup',
      'POST',
      expect.objectContaining({ token: 'a'.repeat(64), expectedRevision: 8 })
    )
  })
})
