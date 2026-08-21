import { describe, expect, it, vi } from 'vitest'
import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import type { BrowserController } from '../../ports/browser-controller.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { ToolOperationJournal } from '../../reliability/operation-journal.js'
import { buildBrowserUseToolProviders } from './browser-use-tool-provider.js'
import { CapabilityRegistry } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

const config: KunCapabilitiesConfig['browserUse'] = {
  enabled: true,
  mode: 'public',
  approvalMode: 'auto-safe',
  maxTabs: 2,
  maxObservationActionsPerTurn: 2,
  maxInteractionActionsPerTurn: 1,
  maxSnapshotNodes: 250,
  maxSnapshotTextChars: 20_000,
  maxImageDimension: 1280,
  idleTimeoutMs: 300_000
}

const expectedTarget = {
  sessionId: 'session-1234567890',
  tabId: 'tab-1',
  documentGeneration: 3,
  origin: 'https://example.test',
  sanitizedUrl: 'https://example.test/settings/security',
  role: 'button',
  name: 'Delete account'
}

function context(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/workspace',
    clientSurface: 'gui',
    agentSurface: 'code',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'deny',
    ...overrides
  }
}

function controller(result: Record<string, unknown> = {
  ok: true,
  code: 'snapshot',
  message: 'bounded snapshot'
}): BrowserController {
  return {
    readiness: () => ({ available: true }),
    execute: vi.fn(async () => result as never)
  }
}

function localToolHost(browserController: BrowserController): LocalToolHost {
  const providers = buildBrowserUseToolProviders(config, {
    controller: browserController
  }).providers
  return new LocalToolHost({
    registry: new CapabilityRegistry(providers)
  })
}

describe('buildBrowserUseToolProviders', () => {
  it('is disabled or interaction-required when host supervision is absent', () => {
    expect(buildBrowserUseToolProviders({ ...config, enabled: false }).providers).toHaveLength(0)
    const unavailable = buildBrowserUseToolProviders(config, {
      controller: {
        readiness: () => ({
          available: false,
          interactionRequired: true,
          reason: 'visible GUI required'
        }),
        execute: vi.fn()
      }
    })
    expect(unavailable).toMatchObject({
      available: false,
      interactionRequired: true,
      reason: 'visible GUI required'
    })
    expect(unavailable.providers[0]?.tools).toHaveLength(0)
  })

  it('advertises one stable primary Code tool but not IM or other surfaces', async () => {
    const result = buildBrowserUseToolProviders(config, { controller: controller() })
    expect(result.providers[0]?.tools.map((tool) => tool.name)).toEqual(['browser_use'])
    const tool = result.providers[0]!.tools[0]!
    expect(tool).toMatchObject({
      policy: 'auto',
      toolKind: 'tool_call',
      effects: {
        network: true,
        externalWrite: true,
        guiAutomation: true
      }
    })
    expect(tool.requiresExplicitApproval).toEqual(expect.any(Function))
    const branches = tool.inputSchema.oneOf as Array<{
      properties: Record<string, { const?: string }>
      required: string[]
    }>
    const open = branches.find((branch) => branch.properties.action?.const === 'open')
    const snapshot = branches.find((branch) => branch.properties.action?.const === 'snapshot')
    expect(Object.keys(open?.properties ?? {})).toEqual(['action', 'url', 'newTab'])
    expect(open?.required).toEqual(['action', 'url'])
    expect(Object.keys(snapshot?.properties ?? {})).toEqual(['action'])
    expect(snapshot?.required).toEqual(['action'])

    const host = localToolHost(controller())
    expect((await host.listTools(context())).map((entry) => entry.name)).toEqual(['browser_use'])
    expect(await host.listTools(context({ imContext: true }))).toHaveLength(0)
    expect(await host.listTools(context({ agentSurface: 'write' }))).toHaveLength(0)
    expect(await host.listTools(context({ agentSurface: 'design' }))).toHaveLength(0)
    expect(await host.listTools(context({ clientSurface: 'api' }))).toHaveLength(0)
    expect(await host.listTools(context({ clientSurface: 'tui' }))).toHaveLength(0)
  })

  it.each([
    ['API', { clientSurface: 'api' }],
    ['TUI', { clientSurface: 'tui' }],
    ['IM', { imContext: true }],
    ['Write', { agentSurface: 'write' }],
    ['Design', { agentSurface: 'design' }]
  ] satisfies Array<[string, Partial<ToolHostContext>]>)(
    'rejects direct execution from the %s surface before reaching Main',
    async (surface, overrides) => {
      const browserController = controller()
      const host = localToolHost(browserController)
      const blockedContext = context({
        turnId: `turn-blocked-${surface.toLowerCase()}`,
        ...overrides
      })

      expect(await host.listTools(blockedContext)).toHaveLength(0)
      await expect(host.execute({
        callId: `call-blocked-${surface.toLowerCase()}`,
        toolName: 'browser_use',
        arguments: { action: 'snapshot' }
      }, blockedContext)).rejects.toThrow(/not advertised/)
      expect(browserController.execute).not.toHaveBeenCalled()
    }
  )

  it('strictly rejects selectors/scripts before calling Main', async () => {
    const browserController = controller()
    const host = localToolHost(browserController)
    const result = await host.execute({
      callId: 'call-invalid',
      toolName: 'browser_use',
      arguments: {
        action: 'click',
        ref: 'opaque-reference-1234',
        expectedTarget,
        selector: '#buy'
      }
    }, context())
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'invalid_action' }
    })
    expect(browserController.execute).not.toHaveBeenCalled()
  })

  it('returns actionable, value-free diagnostics for malformed actions', async () => {
    const browserController = controller()
    const host = localToolHost(browserController)
    const result = await host.execute({
      callId: 'call-invalid-action',
      toolName: 'browser_use',
      arguments: {
        action: 'open',
        url: 'not-a-url',
        unexpected: 'secret-value'
      }
    }, context())

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        kind: 'browser_action',
        ok: false,
        code: 'invalid_action',
        retryable: true,
        attemptedAction: 'open',
        allowedActions: expect.arrayContaining(['open', 'snapshot']),
        requiredFields: ['action', 'url'],
        allowedFields: ['action', 'url', 'newTab'],
        issueCodes: expect.arrayContaining(['invalid_field', 'unexpected_field']),
        issuePaths: ['url'],
        unexpectedFields: ['unexpected'],
        guidance: expect.stringContaining('open')
      }
    })
    expect(JSON.stringify(result.item)).not.toContain('secret-value')
    expect(browserController.execute).not.toHaveBeenCalled()
  })

  it('normalizes null placeholders before approval hashing and execution', async () => {
    const browserController = controller({ ok: true, code: 'opened', message: 'opened' })
    const awaitApproval = vi.fn(async () => ({
      decision: 'allow' as const,
      reviewer: 'agent' as const
    }))
    const host = localToolHost(browserController)
    const normalized = {
      action: 'open' as const,
      url: 'https://example.test/path',
      newTab: true
    }

    const result = await host.execute({
      callId: 'call-open-null-placeholders',
      toolName: 'browser_use',
      arguments: {
        ...normalized,
        ref: null,
        expectedTarget: null,
        text: null,
        direction: null
      }
    }, context({
      approvalPolicy: 'on-request',
      approvalReviewer: 'agent',
      sandboxMode: 'workspace-write',
      awaitApproval
    }))

    expect(result.item).toMatchObject({ isError: false })
    expect(awaitApproval).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({ arguments: normalized })
    }))
    expect(browserController.execute).toHaveBeenCalledWith(expect.objectContaining({
      action: normalized,
      kunApprovalGrant: expect.objectContaining({
        argumentsHash: ToolOperationJournal.argsHash(normalized)
      })
    }))
  })

  it.each([
    ['Ask for approval', 'user'],
    ['Approve for me', 'agent']
  ] as const)(
    'does not review bounded observations in %s',
    async (_mode, approvalReviewer) => {
      const browserController = controller()
      const awaitApproval = vi.fn(async () => 'deny' as const)
      const host = localToolHost(browserController)
      const activeContext = context({
        turnId: `turn-${approvalReviewer}`,
        approvalPolicy: 'on-request',
        approvalReviewer,
        sandboxMode: 'workspace-write',
        awaitApproval
      })

      expect((await host.listTools(activeContext)).map((entry) => entry.name))
        .toEqual(['browser_use'])
      const result = await host.execute({
        callId: `call-${approvalReviewer}`,
        toolName: 'browser_use',
        arguments: { action: 'snapshot' }
      }, activeContext)

      expect(result.item).toMatchObject({
        kind: 'tool_result',
        isError: false,
        output: {
          kind: 'browser_action',
          ok: true,
          code: 'snapshot'
        }
      })
      expect(browserController.execute).toHaveBeenCalledOnce()
      expect(browserController.execute).toHaveBeenCalledWith(
        expect.not.objectContaining({
          kunApprovalMode: expect.anything()
        })
      )
      expect(browserController.execute).toHaveBeenCalledWith(
        expect.not.objectContaining({
          kunApprovalGrant: expect.anything()
        })
      )
      expect(awaitApproval).not.toHaveBeenCalled()
    }
  )

  it('redacts Browser URL credentials from reviewer data while binding the raw action grant', async () => {
    const browserController = controller({
      ok: true,
      code: 'opened',
      message: 'opened'
    })
    const awaitApproval = vi.fn(async (_approval: ApprovalRequest) => ({
      decision: 'allow' as const,
      reviewer: 'agent' as const
    }))
    const host = localToolHost(browserController)
    const action = {
      action: 'open' as const,
      url: 'https://example.test/callback?code=oauth-secret&signature=signed-secret#fragment'
    }

    await host.execute({
      callId: 'call-open-redacted',
      toolName: 'browser_use',
      arguments: action
    }, context({
      approvalPolicy: 'on-request',
      approvalReviewer: 'agent',
      sandboxMode: 'workspace-write',
      awaitApproval
    }))

    const approval = awaitApproval.mock.calls[0]?.[0]
    expect(approval?.action?.arguments).toEqual({
      action: 'open',
      url: 'https://example.test/callback'
    })
    expect(approval?.action?.targets).toContainEqual({
      kind: 'url',
      value: 'https://example.test/callback'
    })
    expect(JSON.stringify(approval)).not.toContain('oauth-secret')
    expect(JSON.stringify(approval)).not.toContain('signed-secret')
    expect(browserController.execute).toHaveBeenCalledWith(expect.objectContaining({
      action,
      kunApprovalGrant: expect.objectContaining({
        argumentsHash: ToolOperationJournal.argsHash(action)
      })
    }))
  })

  it.each([
    ['Ask for approval', 'user'],
    ['Approve for me', 'agent']
  ] as const)(
    'routes approval-worthy actions through the shared %s reviewer boundary',
    async (_mode, approvalReviewer) => {
      const browserController = controller({
        ok: true,
        code: 'opened',
        message: 'opened'
      })
      const awaitApproval = vi.fn(async () => ({
        decision: 'allow' as const,
        reviewer: approvalReviewer
      }))
      const host = localToolHost(browserController)
      const activeContext = context({
        approvalPolicy: 'on-request',
        approvalReviewer,
        sandboxMode: 'workspace-write',
        awaitApproval
      })
      const action = {
        action: 'open' as const,
        url: 'https://example.test/path'
      }

      const result = await host.execute({
        callId: `call-open-${approvalReviewer}`,
        toolName: 'browser_use',
        arguments: action
      }, activeContext)

      expect(result.item).toMatchObject({
        kind: 'tool_result',
        isError: false
      })
      expect(awaitApproval).toHaveBeenCalledWith(expect.objectContaining({
        toolName: 'browser_use',
        action: expect.objectContaining({
          arguments: action,
          kind: 'external-effect',
          effects: expect.objectContaining({
            network: true,
            externalWrite: true,
            guiAutomation: true
          })
        })
      }))
      expect(browserController.execute).toHaveBeenCalledWith(expect.objectContaining({
        action,
        kunApprovalMode: approvalReviewer,
        kunApprovalGrant: expect.objectContaining({
          id: expect.stringMatching(/^appr_[a-f0-9]{32}$/),
          source: approvalReviewer,
          toolName: 'browser_use',
          callId: `call-open-${approvalReviewer}`,
          argumentsHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      }))
    }
  )

  it('bypasses review only in canonical Full access and sends a scoped host grant', async () => {
    const browserController = controller({
      ok: true,
      code: 'opened',
      message: 'opened'
    })
    const awaitApproval = vi.fn(async () => 'deny' as const)
    const host = localToolHost(browserController)
    const action = {
      action: 'open' as const,
      url: 'https://example.test/path'
    }

    await host.execute({
      callId: 'call-open-full-access',
      toolName: 'browser_use',
      arguments: action
    }, context({
      approvalPolicy: 'auto',
      approvalReviewer: 'user',
      sandboxMode: 'danger-full-access',
      awaitApproval
    }))

    expect(awaitApproval).not.toHaveBeenCalled()
    expect(browserController.execute).toHaveBeenCalledWith(expect.objectContaining({
      action,
      kunApprovalMode: 'full-access',
      kunApprovalGrant: expect.objectContaining({
        id: expect.stringMatching(/^grant_[a-f0-9]{32}$/),
        source: 'full-access'
      })
    }))
  })

  it('denies a boundary action before Main when the configured reviewer denies it', async () => {
    const browserController = controller()
    const awaitApproval = vi.fn(async () => ({
      decision: 'deny' as const,
      reviewer: 'agent' as const,
      reason: 'The navigation is unrelated.'
    }))
    const host = localToolHost(browserController)
    const result = await host.execute({
      callId: 'call-denied-open',
      toolName: 'browser_use',
      arguments: {
        action: 'open',
        url: 'https://example.test/path'
      }
    }, context({
      approvalPolicy: 'on-request',
      approvalReviewer: 'agent',
      sandboxMode: 'workspace-write',
      awaitApproval
    }))

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        code: 'approval_denied',
        reviewer: 'agent',
        reason: 'The navigation is unrelated.'
      }
    })
    expect(browserController.execute).not.toHaveBeenCalled()
  })

  it('keeps Browser Host validation authoritative after Kun approval and enforces budgets', async () => {
    const browserController = controller({
      ok: false,
      code: 'consent_denied',
      message: 'user denied'
    })
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const host = localToolHost(browserController)
    const activeContext = context({
      approvalPolicy: 'on-request',
      approvalReviewer: 'user',
      sandboxMode: 'workspace-write',
      awaitApproval
    })
    const first = await host.execute({
      callId: 'call-click-1',
      toolName: 'browser_use',
      arguments: {
        action: 'click',
        ref: 'opaque-reference-1234',
        expectedTarget
      }
    }, activeContext)
    expect(first.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'consent_denied' }
    })
    expect(awaitApproval).toHaveBeenCalledOnce()
    expect(awaitApproval).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({
        targets: expect.arrayContaining([
          {
            kind: 'url',
            value: 'https://example.test/settings/security'
          },
          {
            kind: 'resource',
            value: expect.stringContaining('"name":"Delete account"')
          }
        ])
      })
    }))
    expect(browserController.execute).toHaveBeenCalledOnce()

    const second = await host.execute({
      callId: 'call-click-2',
      toolName: 'browser_use',
      arguments: {
        action: 'click',
        ref: 'another-reference-1234',
        expectedTarget
      }
    }, activeContext)
    expect(second.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'action_budget_exhausted' }
    })
    expect(browserController.execute).toHaveBeenCalledOnce()
  })

  it('projects screenshots into the bounded model image pipeline', async () => {
    const browserController = controller({
      ok: true,
      code: 'screenshot',
      message: 'captured',
      image: { mediaType: 'image/png', data: 'PNGDATA' }
    })
    const host = localToolHost(browserController)
    const result = await host.execute({
      callId: 'call-screenshot',
      toolName: 'browser_use',
      arguments: { action: 'screenshot' }
    }, context())
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      output: {
        kind: 'browser_screenshot',
        images: [{ data_base64: 'PNGDATA' }]
      }
    })
  })
})
