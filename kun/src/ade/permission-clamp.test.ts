import { describe, expect, test, vi } from 'vitest'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import type { ApprovalRequest } from '../domain/approval.js'
import type { HarnessPermissionMode } from '../contracts/harness.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { SessionStore } from '../ports/session-store.js'
import type { TurnService } from '../services/turn-service.js'
import { InteractiveToolBridge } from '../loop/interactive-tool-bridge.js'
import {
  authorityFromTurn,
  clampPermission,
  PERMISSION_RANK
} from './permission-clamp.js'
import {
  requestUserOnlyEscalation,
  type EscalationApprovalContext
} from './escalation-approval.js'

const harnessModes: HarnessPermissionMode[] = [
  { id: 'default', label: 'Default', kunPermissionMode: 'ask-for-approval' },
  { id: 'acceptEdits', label: 'Accept edits', kunPermissionMode: 'approve-for-me' },
  { id: 'bypassPermissions', label: 'Bypass', kunPermissionMode: 'full-access' }
]
const harness = { permissionModes: harnessModes }

const askThread = {
  approvalPolicy: 'on-request' as const,
  sandboxMode: 'workspace-write' as const,
  approvalReviewer: 'user' as const
}
const approveForMeThread = { ...askThread, approvalReviewer: 'agent' as const }
const fullAccessThread = {
  approvalPolicy: 'auto' as const,
  sandboxMode: 'danger-full-access' as const,
  approvalReviewer: 'user' as const
}

const guiTurn = { clientSurface: 'gui' as const }

describe('authorityFromTurn', () => {
  test('projects canonical modes and falls back to ask for noncanonical mixes', () => {
    expect(authorityFromTurn(askThread, guiTurn).kunPermissionMode).toBe('ask-for-approval')
    expect(authorityFromTurn(approveForMeThread, guiTurn).kunPermissionMode).toBe('approve-for-me')
    expect(authorityFromTurn(fullAccessThread, guiTurn).kunPermissionMode).toBe('full-access')
    expect(authorityFromTurn(
      { ...askThread, approvalPolicy: 'auto' }, // auto + workspace-write: not canonical
      guiTurn
    ).kunPermissionMode).toBe('ask-for-approval')
  })

  test('turn overrides beat thread defaults', () => {
    const turn = { ...guiTurn, ...fullAccessThread }
    expect(authorityFromTurn(askThread, turn).kunPermissionMode).toBe('full-access')
  })

  test('only gui/tui surfaces without imContext are interactive', () => {
    expect(authorityFromTurn(askThread, guiTurn).interactive).toBe(true)
    expect(authorityFromTurn(askThread, { clientSurface: 'tui' }).interactive).toBe(true)
    for (const clientSurface of ['cli', 'api', 'im', 'extension'] as const) {
      expect(authorityFromTurn(askThread, { clientSurface }).interactive).toBe(false)
    }
    expect(authorityFromTurn(askThread, undefined).interactive).toBe(false)
    expect(authorityFromTurn(
      askThread,
      { clientSurface: 'gui', imContext: true }
    ).interactive).toBe(false)
  })
})

describe('clampPermission', () => {
  test('ask-for-approval manager requesting full-access clamps and asks', () => {
    const result = clampPermission(
      harness,
      'bypassPermissions',
      authorityFromTurn(askThread, guiTurn)
    )
    expect(result).toMatchObject({
      effective: 'default',
      downgraded: true,
      needsUserConfirmation: true
    })
    expect(result.requestedMode?.id).toBe('bypassPermissions')
  })

  test('full-access manager requesting full-access is honored without asking', () => {
    expect(clampPermission(
      harness,
      'bypassPermissions',
      authorityFromTurn(fullAccessThread, guiTurn)
    )).toMatchObject({
      effective: 'bypassPermissions',
      downgraded: false,
      needsUserConfirmation: false
    })
  })

  test('unattended turns never ask; they just clamp', () => {
    for (const clientSurface of ['im', 'api', 'cli'] as const) {
      const result = clampPermission(
        harness,
        'bypassPermissions',
        authorityFromTurn(askThread, { clientSurface })
      )
      expect(result.downgraded).toBe(true)
      expect(result.needsUserConfirmation).toBe(false)
      expect(result.effective).toBe('default')
    }
  })

  test('harness with no mode at or below the manager falls back to modes[0]', () => {
    const onlyFull = {
      permissionModes: [
        { id: 'yolo', label: 'Yolo', kunPermissionMode: 'full-access' as const }
      ]
    }
    expect(clampPermission(
      onlyFull,
      'yolo',
      authorityFromTurn(askThread, guiTurn)
    )).toMatchObject({ effective: 'yolo', downgraded: true })
    // No requested mode -> strictest declared mode.
    expect(clampPermission(
      onlyFull,
      undefined,
      authorityFromTurn(fullAccessThread, guiTurn)
    ).effective).toBe('yolo')
  })

  test('a requested mode within the manager rank is used verbatim', () => {
    expect(clampPermission(
      harness,
      'default',
      authorityFromTurn(fullAccessThread, guiTurn)
    )).toMatchObject({ effective: 'default', downgraded: false })
    expect(clampPermission(
      harness,
      undefined,
      authorityFromTurn(approveForMeThread, guiTurn)
    ).effective).toBe('acceptEdits')
  })

  test('PERMISSION_RANK covers every product mode strictly increasing', () => {
    expect(PERMISSION_RANK).toEqual({
      'ask-for-approval': 0,
      'approve-for-me': 1,
      'full-access': 2
    })
  })
})

describe('requestUserOnlyEscalation', () => {
  const mode = harnessModes[2]!

  const context = (awaitApproval: EscalationApprovalContext['awaitApproval']) =>
    ({
      threadId: 'thread_1',
      turnId: 'turn_1',
      nextId: (prefix: string) => `${prefix}_1`,
      awaitApproval
    }) satisfies EscalationApprovalContext

  test('builds a user-only external-effect envelope and resolves allow', async () => {
    const seen: ApprovalRequest[] = []
    const granted = await requestUserOnlyEscalation(
      context(async (approval) => {
        seen.push(approval)
        return 'allow'
      }),
      {
        workerLabel: '登录修复',
        harnessName: 'Claude Code',
        workspacePath: '/tmp/worktree-1',
        mode
      }
    )
    expect(granted).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolName: 'ade.worker_permission_escalation',
      status: 'pending',
      action: {
        kind: 'external-effect',
        providerKind: 'delegation',
        reviewerRequirement: 'user',
        requiresUserDecision: true,
        workspace: '/tmp/worktree-1'
      }
    })
  })

  test('deny and channel failure both resolve false with no side effects', async () => {
    await expect(requestUserOnlyEscalation(
      context(async () => 'deny'),
      { workerLabel: 'w', harnessName: 'h', workspacePath: '/w', mode }
    )).resolves.toBe(false)
    await expect(requestUserOnlyEscalation(
      context(async () => { throw new Error('turn aborted while awaiting approval') }),
      { workerLabel: 'w', harnessName: 'h', workspacePath: '/w', mode }
    )).resolves.toBe(false)
    await expect(requestUserOnlyEscalation(
      context(async () => ({ decision: 'deny' as const, reviewer: 'user' as const })),
      { workerLabel: 'w', harnessName: 'h', workspacePath: '/w', mode }
    )).resolves.toBe(false)
  })

  const bridgeContext = (
    gate: InMemoryApprovalGate,
    input: {
      approvalPolicy: 'auto' | 'on-request'
      approvalReviewer?: 'user' | 'agent'
      review?: ReturnType<typeof vi.fn>
      signal: AbortSignal
    }
  ): EscalationApprovalContext => {
    const bridge = new InteractiveToolBridge({
      approvalGate: gate,
      approvalReview: { review: input.review ?? vi.fn() } as never,
      userInputGate: new InMemoryUserInputGate(),
      events: { record: vi.fn(async () => undefined) } as never,
      turns: {} as TurnService,
      sessionStore: {} as SessionStore,
      nowIso: () => '2026-07-29T00:00:00.000Z'
    })
    return context((approval) =>
      bridge.awaitApproval({
        approval,
        approvalPolicy: input.approvalPolicy,
        ...(input.approvalReviewer
          ? { approvalReviewer: input.approvalReviewer }
          : {}),
        sandboxMode: 'danger-full-access',
        actingModelRoute: { model: 'm', providerId: 'p' },
        signal: input.signal
      }) as Promise<'allow' | 'deny'>)
  }

  test('user-only escalation skips the agent reviewer under approve-for-me', async () => {
    const gate = new InMemoryApprovalGate()
    const review = vi.fn(async () => ({
      decision: 'allow' as const,
      reviewer: 'agent' as const,
      reviewStatus: 'approved' as const
    }))
    const signal = new AbortController().signal
    const pendingEscalation = requestUserOnlyEscalation(
      bridgeContext(gate, {
        approvalPolicy: 'on-request',
        approvalReviewer: 'agent',
        review,
        signal
      }),
      { workerLabel: 'w', harnessName: 'h', workspacePath: '/w', mode }
    )
    await vi.waitFor(() => expect(gate.pending('thread_1')).toHaveLength(1))
    expect(review).not.toHaveBeenCalled()
    gate.decide('esc_1', 'deny', 'user declined')
    await expect(pendingEscalation).resolves.toBe(false)
  })

  test('user-only escalation still waits for the user under auto policy', async () => {
    const gate = new InMemoryApprovalGate()
    const signal = new AbortController().signal
    const pendingEscalation = requestUserOnlyEscalation(
      bridgeContext(gate, {
        approvalPolicy: 'auto',
        approvalReviewer: 'agent',
        signal
      }),
      { workerLabel: 'w', harnessName: 'h', workspacePath: '/w', mode }
    )
    // Auto + danger-full-access would normally resolve 'allow' immediately.
    await vi.waitFor(() => expect(gate.pending('thread_1')).toHaveLength(1))
    gate.decide('esc_1', 'allow')
    await expect(pendingEscalation).resolves.toBe(true)
  })

  test('cancelling the turn denies the escalation and expires the request', async () => {
    const gate = new InMemoryApprovalGate()
    const controller = new AbortController()
    const pendingEscalation = requestUserOnlyEscalation(
      bridgeContext(gate, {
        approvalPolicy: 'on-request',
        signal: controller.signal
      }),
      { workerLabel: 'w', harnessName: 'h', workspacePath: '/w', mode }
    )
    await vi.waitFor(() => expect(gate.pending('thread_1')).toHaveLength(1))
    controller.abort()
    await expect(pendingEscalation).resolves.toBe(false)
    expect(gate.get('esc_1')?.status).toBe('expired')
  })
})
