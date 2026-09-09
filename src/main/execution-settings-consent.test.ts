import { describe, expect, it } from 'vitest'
import {
  KunExecutionSettingsConsentService,
  kunExecutionSettingsChange,
  type KunExecutionSettingsConsentAction
} from './execution-settings-consent'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

describe('protected Kun execution settings consent', () => {
  it('detects changed execution security settings but ignores equal snapshots', () => {
    const current = settings()
    expect(kunExecutionSettingsChange(current, {
      agents: { kun: {
        approvalPolicy: current.agents.kun.approvalPolicy,
        sandboxMode: current.agents.kun.sandboxMode,
        approvalReviewer: current.agents.kun.approvalReviewer
      } }
    })).toBeUndefined()
    expect(kunExecutionSettingsChange(current, {
      agents: {
        kun: {
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          approvalReviewer: 'user'
        }
      }
    })).toEqual({
      current: {
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        approvalReviewer: 'user',
        approvalReview: { mode: 'inherit' }
      },
      next: {
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'user',
        approvalReview: { mode: 'inherit' }
      }
    })
  })

  it('protects a reviewer-only transition', () => {
    const current = settings()
    expect(kunExecutionSettingsChange(current, {
      agents: { kun: { approvalReviewer: 'agent' } }
    })).toEqual({
      current: {
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        approvalReviewer: 'user',
        approvalReview: { mode: 'inherit' }
      },
      next: {
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        approvalReviewer: 'agent',
        approvalReview: { mode: 'inherit' }
      }
    })
  })

  it('protects an approval-review-model-only transition', () => {
    const current = settings()
    expect(kunExecutionSettingsChange(current, {
      agents: { kun: {
        approvalReview: {
          mode: 'fixed',
          providerId: 'review-provider',
          model: 'review-model'
        }
      } }
    })).toMatchObject({
      current: { approvalReview: { mode: 'inherit' } },
      next: {
        approvalReview: {
          mode: 'fixed',
          providerId: 'review-provider',
          model: 'review-model'
        }
      }
    })
    expect(kunExecutionSettingsChange(current, {
      agents: { kun: { approvalReview: { mode: 'inherit' } } }
    })).toBeUndefined()
  })

  it('binds a short-lived token to one exact sender and settings transition', () => {
    let now = 1_000
    let tokenNumber = 0
    const service = new KunExecutionSettingsConsentService(
      () => now,
      () => `token-${++tokenNumber}`
    )
    const action: KunExecutionSettingsConsentAction = {
      current: {
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'user',
        approvalReview: { mode: 'inherit' }
      },
      next: {
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent',
        approvalReview: { mode: 'fixed', providerId: 'review-provider', model: 'review-model' }
      },
      senderId: 7,
      senderProcessId: 10,
      senderRoutingId: 20
    }
    const wrongToken = service.issue(action)
    expect(service.consume(wrongToken, {
      ...action,
      next: { ...action.next, approvalReviewer: 'user' }
    })).toBe(false)
    expect(service.consume(wrongToken, action)).toBe(false)

    const validToken = service.issue(action)
    expect(service.consume(validToken, action)).toBe(true)
    expect(service.consume(validToken, action)).toBe(false)

    const expiredToken = service.issue(action)
    now += 30_001
    expect(service.consume(expiredToken, action)).toBe(false)
  })
})
