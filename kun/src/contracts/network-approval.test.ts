import { describe, expect, it } from 'vitest'
import {
  evaluateNetworkApproval,
  isLocalNetworkHost,
  normalizeNetworkHost
} from './network-approval.js'

const request = {
  requestId: 'call-1',
  host: 'API.Example.com.',
  port: 443,
  operation: 'read' as const
}

describe('network approval contract', () => {
  it('denies none, allows full, and requests approval in approved mode', () => {
    expect(evaluateNetworkApproval('none', request)).toEqual({ allowed: false, reason: 'denied-by-policy' })
    expect(evaluateNetworkApproval('full', request)).toEqual({ allowed: true, reason: 'full-access' })
    expect(evaluateNetworkApproval('approved', request)).toEqual({ allowed: false, reason: 'approval-required' })
  })

  it('matches host-port grants and separates read from mutation', () => {
    const grant = {
      scope: 'host-port' as const,
      host: 'api.example.com',
      port: 443,
      operation: 'read' as const
    }
    expect(evaluateNetworkApproval('approved', request, [grant])).toEqual({
      allowed: true,
      reason: 'already-approved'
    })
    expect(evaluateNetworkApproval('approved', { ...request, operation: 'mutation' }, [grant]).reason)
      .toBe('approval-required')
    expect(evaluateNetworkApproval('approved', { ...request, operation: 'mutation' }, [{ ...grant, operation: 'mutation' }]))
      .toEqual({ allowed: true, reason: 'already-approved' })
  })

  it('requires a matching request id for call grants and explicit localhost approval', () => {
    const callGrant = {
      scope: 'call' as const,
      requestId: 'call-1',
      host: 'api.example.com',
      port: 443,
      operation: 'read' as const
    }
    expect(evaluateNetworkApproval('approved', request, [callGrant]).allowed).toBe(true)
    expect(evaluateNetworkApproval('approved', { ...request, requestId: 'call-2' }, [callGrant]).allowed).toBe(false)

    const localhost = { ...request, host: 'localhost', port: 3000 }
    const grant = { scope: 'host-port' as const, host: 'localhost', port: 3000, operation: 'read' as const }
    expect(evaluateNetworkApproval('approved', localhost, [grant]).reason).toBe('approval-required')
    expect(evaluateNetworkApproval('approved', localhost, [{ ...grant, allowLocalhost: true }]).allowed).toBe(true)
  })

  it('normalizes safe hosts and fails closed for malformed requests or grants', () => {
    expect(normalizeNetworkHost(' Example.COM. ')).toBe('example.com')
    expect(normalizeNetworkHost('https://example.com')).toBeNull()
    expect(isLocalNetworkHost('127.0.0.1')).toBe(true)
    expect(isLocalNetworkHost('example.com')).toBe(false)
    expect(evaluateNetworkApproval('approved', { ...request, port: 0 })).toEqual({
      allowed: false,
      reason: 'invalid-request'
    })
    expect(evaluateNetworkApproval('unexpected' as never, request)).toEqual({
      allowed: false,
      reason: 'denied-by-policy'
    })
    expect(evaluateNetworkApproval('approved', { ...request, extra: true } as never)).toEqual({
      allowed: false,
      reason: 'invalid-request'
    })
    expect(evaluateNetworkApproval('approved', request, [{ ...callGrantForTest(), port: 0 }])).toEqual({
      allowed: false,
      reason: 'approval-required'
    })
  })
})

function callGrantForTest() {
  return {
    scope: 'host-port' as const,
    host: 'api.example.com',
    port: 443,
    operation: 'read' as const
  }
}
