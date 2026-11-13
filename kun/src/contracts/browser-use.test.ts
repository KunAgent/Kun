import { describe, expect, it } from 'vitest'
import {
  BrowserUseActionInput,
  BrowserUseBridgeRequest,
  BrowserUseBridgeResponse,
  BrowserUseHostChallengeRequest,
  isBrowserUseApprovalBoundaryAction,
  isBrowserUseStateAdvancingAction,
  normalizeBrowserUseActionInput,
  redactBrowserUseActionForPersistence,
  redactBrowserUseUrl,
  signBrowserUseBridgeResponse,
  signBrowserUseHostChallenge,
  signBrowserUseKunApprovalGrant,
  summarizeBrowserUseActionValidation,
  verifyBrowserUseBridgeResponse,
  verifyBrowserUseHostChallenge,
  verifyBrowserUseKunApprovalGrant
} from './browser-use.js'
import { ToolOperationJournal } from '../reliability/operation-journal.js'

const expectedTarget = {
  sessionId: 'session-1234567890',
  tabId: 'tab-1',
  documentGeneration: 3,
  origin: 'https://example.com',
  sanitizedUrl: 'https://example.com/form',
  role: 'textbox',
  name: 'Public note'
}

describe('BrowserUseActionInput', () => {
  it('accepts only the stable bounded action catalog', () => {
    expect(BrowserUseActionInput.parse({ action: 'snapshot' })).toEqual({ action: 'snapshot' })
    expect(BrowserUseActionInput.parse({
      action: 'open',
      url: 'https://example.com',
      newTab: true
    })).toEqual({ action: 'open', url: 'https://example.com', newTab: true })
    expect(BrowserUseActionInput.parse({
      action: 'type',
      ref: 'opaque-reference-1234',
      expectedTarget,
      text: 'bounded text'
    })).toEqual({
      action: 'type',
      ref: 'opaque-reference-1234',
      expectedTarget,
      text: 'bounded text'
    })
  })

  it('removes optional null placeholders while preserving required or unknown fields', () => {
    const raw = {
      action: 'open',
      url: 'https://example.com',
      newTab: null,
      ref: null,
      text: null
    }
    expect(normalizeBrowserUseActionInput(raw)).toEqual({
      action: 'open',
      url: 'https://example.com'
    })
    expect(normalizeBrowserUseActionInput({ ...raw, ref: 'non-empty' })).toHaveProperty('ref')
    expect(normalizeBrowserUseActionInput({ ...raw, url: null })).toHaveProperty('url', null)
    expect(normalizeBrowserUseActionInput({
      action: 'open',
      url: 'https://example.com',
      selector: null
    })).toHaveProperty('selector')
  })

  it.each([
    { action: 'click', ref: 'opaque-reference-1234', expectedTarget, selector: '#buy' },
    { action: 'snapshot', script: 'document.cookie' },
    { action: 'open', url: 'file:///etc/passwd' },
    { action: 'open', url: 'https://user:secret@example.com/private' },
    {
      action: 'type',
      ref: 'opaque-reference-1234',
      expectedTarget,
      text: 'x',
      filePath: '/tmp/x'
    },
    {
      action: 'type',
      ref: 'opaque-reference-1234',
      expectedTarget,
      text: 'x',
      submit: true
    },
    { action: 'cdp', method: 'Runtime.evaluate' }
  ])('rejects ambient or executable input %#', (input) => {
    expect(BrowserUseActionInput.safeParse(input).success).toBe(false)
  })

  it.each([
    { action: 'click', ref: 'opaque-reference-1234' },
    { action: 'type', ref: 'opaque-reference-1234', text: 'hello' },
    { action: 'select', ref: 'opaque-reference-1234', value: 'one' },
    { action: 'press', ref: 'opaque-reference-1234', key: 'Enter' }
  ])('rejects interaction actions without the exact snapshot target binding %#', (input) => {
    expect(BrowserUseActionInput.safeParse(input).success).toBe(false)
  })

  it('requires thread scope and a UUID request id at the bridge boundary', () => {
    expect(BrowserUseBridgeRequest.safeParse({
      contractVersion: 2,
      requestId: 'not-a-uuid',
      threadId: '',
      turnId: '',
      action: { action: 'snapshot' }
    }).success).toBe(false)
    expect(BrowserUseBridgeRequest.safeParse({
      contractVersion: 2,
      requestId: '00000000-0000-4000-8000-000000000000',
      threadId: 'thread-1',
      turnId: 'turn-1',
      action: { action: 'snapshot' },
      kunApprovalMode: 'full-access'
    }).success).toBe(false)
  })

  it('requires a short action-bound Kun grant for approval-worthy bridge actions', () => {
    const action = { action: 'open' as const, url: 'https://example.test/path' }
    const signingKey = 's'.repeat(43)
    const base = {
      contractVersion: 2 as const,
      requestId: '00000000-0000-4000-8000-000000000000',
      threadId: 'thread-1',
      turnId: 'turn-1',
      action
    }
    expect(BrowserUseBridgeRequest.safeParse(base).success).toBe(false)
    const grant = signBrowserUseKunApprovalGrant({
      id: `appr_${'a'.repeat(32)}`,
      source: 'agent',
      toolName: 'browser_use',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-open',
      argumentsHash: ToolOperationJournal.argsHash(action),
      issuedAt: '2026-07-30T00:00:00.000Z',
      expiresAt: '2026-07-30T00:02:00.000Z'
    }, signingKey)
    expect(BrowserUseBridgeRequest.safeParse({
      ...base,
      kunApprovalMode: 'agent',
      kunApprovalGrant: grant
    }).success).toBe(true)
    expect(verifyBrowserUseKunApprovalGrant(grant, signingKey)).toBe(true)
    expect(verifyBrowserUseKunApprovalGrant({
      ...grant,
      turnId: 'turn-substituted'
    }, signingKey)).toBe(false)
    expect(verifyBrowserUseKunApprovalGrant({
      ...grant,
      source: 'user'
    }, signingKey)).toBe(false)
    expect(BrowserUseBridgeRequest.safeParse({
      ...base,
      kunApprovalMode: 'agent',
      kunApprovalGrant: {
        ...grant,
        expiresAt: '2026-07-30T00:20:00.000Z'
      }
    }).success).toBe(false)
  })

  it('strictly authenticates host challenges and complete bridge results', () => {
    const signingKey = 's'.repeat(43)
    const challenge = BrowserUseHostChallengeRequest.parse({
      contractVersion: 2,
      nonce: '00000000-0000-4000-8000-000000000001'
    })
    const proof = signBrowserUseHostChallenge(challenge, signingKey)
    expect(verifyBrowserUseHostChallenge(proof, signingKey)).toBe(true)
    expect(verifyBrowserUseHostChallenge({
      ...proof,
      nonce: '00000000-0000-4000-8000-000000000002'
    }, signingKey)).toBe(false)

    const response = signBrowserUseBridgeResponse({
      contractVersion: 2,
      requestId: '00000000-0000-4000-8000-000000000003',
      result: { ok: true, code: 'snapshot', message: 'bounded' }
    }, signingKey)
    expect(BrowserUseBridgeResponse.safeParse(response).success).toBe(true)
    expect(verifyBrowserUseBridgeResponse(response, signingKey)).toBe(true)
    expect(verifyBrowserUseBridgeResponse({
      ...response,
      result: { ...response.result, message: 'forged success' }
    }, signingKey)).toBe(false)
    expect(BrowserUseBridgeResponse.safeParse({
      ...response,
      responseMac: undefined
    }).success).toBe(false)
    expect(BrowserUseHostChallengeRequest.safeParse({
      ...challenge,
      action: { action: 'snapshot' }
    }).success).toBe(false)

    const reordered = signBrowserUseBridgeResponse({
      requestId: '00000000-0000-4000-8000-000000000003',
      result: { message: 'bounded', code: 'snapshot', ok: true },
      contractVersion: 2
    }, signingKey)
    expect(reordered.responseMac).toBe(response.responseMac)
  })
})

describe('redactBrowserUseUrl', () => {
  it('omits query strings and fragments', () => {
    expect(redactBrowserUseUrl('https://example.com/path?q=secret#token'))
      .toBe('https://example.com/path')
  })

  it('redacts persisted query strings and entered values while preserving executable shape', () => {
    expect(redactBrowserUseActionForPersistence({
      action: 'open',
      url: 'https://example.com/path?q=secret#token'
    })).toEqual({ action: 'open', url: 'https://example.com/path' })
    expect(redactBrowserUseActionForPersistence({
      action: 'type',
      ref: 'opaque-reference-1234',
      expectedTarget,
      text: 'private value'
    })).toEqual({
      action: 'type',
      ref: 'opaque-reference-1234',
      expectedTarget: {
        ...expectedTarget,
        name: '[redacted]'
      },
      text: '[redacted]'
    })
  })

  it('preserves safe diagnostics for malformed recognized actions', () => {
    expect(redactBrowserUseActionForPersistence({
      action: 'open',
      url: 'https://example.com/path?token=secret#fragment',
      newTab: true,
      unexpected: 'do not persist'
    })).toEqual({
      action: 'open',
      url: 'https://example.com/path',
      newTab: true,
      unexpectedFields: ['unexpected']
    })
    expect(redactBrowserUseActionForPersistence({
      action: 'navigate',
      url: 'https://example.com/path?token=secret'
    })).toEqual({})
    expect(redactBrowserUseActionForPersistence({
      url: 'https://example.com/path?token=secret'
    })).toEqual({})
  })

  it('summarizes malformed actions without echoing raw values or unknown fields', () => {
    const summary = summarizeBrowserUseActionValidation({
      action: 'open',
      url: 'not-a-url',
      secretField: 'oauth-secret'
    })
    expect(summary).toMatchObject({
      attemptedAction: 'open',
      requiredFields: ['action', 'url'],
      allowedFields: ['action', 'url', 'newTab'],
      issueCodes: expect.arrayContaining(['invalid_field', 'unexpected_field']),
      issuePaths: ['url'],
      unexpectedFields: ['secretField']
    })
    expect(JSON.stringify(summary)).not.toContain('oauth-secret')
    expect(summary.unexpectedFields).toEqual(['secretField'])

    const unsupported = summarizeBrowserUseActionValidation({ action: 'navigate' })
    expect(unsupported).toMatchObject({
      attemptedAction: 'unsupported',
      issueCodes: ['unsupported_action'],
      requiredFields: [],
      allowedFields: []
    })
    expect(unsupported.guidance).toContain('snapshot')
  })

  it('classifies Browser Use observations and state transitions for loop protection', () => {
    expect(isBrowserUseStateAdvancingAction({ action: 'snapshot' })).toBe(false)
    expect(isBrowserUseStateAdvancingAction({ action: 'screenshot' })).toBe(false)
    expect(isBrowserUseStateAdvancingAction({ action: 'tabs', operation: 'list' })).toBe(false)
    expect(isBrowserUseStateAdvancingAction({ action: 'wait' })).toBe(true)
    expect(isBrowserUseStateAdvancingAction({ action: 'tabs', operation: 'switch', tabId: 'tab-1' })).toBe(true)
    expect(isBrowserUseStateAdvancingAction({ action: 'navigate', url: 'https://example.com' })).toBe(false)
  })
})

describe('BrowserUseActionInput batch', () => {
  const typeStep = {
    action: 'type' as const,
    ref: 'opaque-reference-1234',
    expectedTarget,
    text: 'Public note text'
  }
  const clickStep = {
    action: 'click' as const,
    ref: 'opaque-reference-1234',
    expectedTarget
  }

  it('accepts ordinary single actions as steps and nothing else', () => {
    const batch = { action: 'batch', steps: [typeStep, clickStep] }
    expect(BrowserUseActionInput.parse(batch)).toEqual(batch)
    expect(BrowserUseActionInput.safeParse({ action: 'batch', steps: [] }).success).toBe(false)
    expect(BrowserUseActionInput.safeParse({
      action: 'batch',
      steps: [{ action: 'screenshot' }]
    }).success).toBe(false)
    expect(BrowserUseActionInput.safeParse({
      action: 'batch',
      steps: [{ action: 'close' }]
    }).success).toBe(false)
    expect(BrowserUseActionInput.safeParse({
      action: 'batch',
      steps: [{ action: 'batch', steps: [{ action: 'snapshot' }] }]
    }).success).toBe(false)
    expect(BrowserUseActionInput.safeParse({
      action: 'batch',
      steps: Array.from({ length: 11 }, () => ({ action: 'snapshot' }))
    }).success).toBe(false)
  })

  it('inherits approval and loop-protection scope from its steps', () => {
    expect(isBrowserUseApprovalBoundaryAction({
      action: 'batch',
      steps: [{ action: 'snapshot' }, typeStep]
    })).toBe(true)
    expect(isBrowserUseApprovalBoundaryAction({
      action: 'batch',
      steps: [{ action: 'snapshot' }, { action: 'wait', milliseconds: 100 }]
    })).toBe(false)
    expect(isBrowserUseStateAdvancingAction({
      action: 'batch',
      steps: [{ action: 'snapshot' }]
    })).toBe(false)
    expect(isBrowserUseStateAdvancingAction({
      action: 'batch',
      steps: [{ action: 'snapshot' }, typeStep]
    })).toBe(true)
  })

  it('redacts entered text inside steps before persistence', () => {
    const redacted = redactBrowserUseActionForPersistence({
      action: 'batch',
      steps: [
        { ...typeStep },
        { action: 'open', url: 'https://example.com/path?token=secret' }
      ]
    }) as { steps: Array<Record<string, unknown>> }
    expect(redacted.steps[0]).toMatchObject({
      text: '[redacted]',
      expectedTarget: { name: '[redacted]' }
    })
    expect(redacted.steps[1]).toEqual({ action: 'open', url: 'https://example.com/path' })
  })
})
