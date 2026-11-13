import { describe, expect, it } from 'vitest'
import { ApprovalActionEnvelopeSchema } from '../contracts/approvals.js'
import {
  createApprovalActionEnvelope,
  redactApprovalSensitiveText,
  safeApprovalActionSummary
} from './approval.js'

describe('approval action envelopes', () => {
  it('omits unresolved raw tool arguments from review and durable approval data', () => {
    const raw = '{"plan":{"title":"private-approval-marker"'
    const action = createApprovalActionEnvelope({
      toolName: 'graph_define_plan',
      providerId: 'builtin',
      toolKind: 'tool_call',
      arguments: { __raw: raw },
      workspace: '/workspace',
      reason: 'approval policy requires review'
    })

    expect(action.arguments).toEqual({})
    expect(JSON.stringify(action)).not.toContain('private-approval-marker')
  })

  it('captures trusted effects and exact targets while redacting credentials', () => {
    const action = createApprovalActionEnvelope({
      toolName: 'mcp_call_tool',
      providerId: 'mcp:docs',
      providerKind: 'mcp',
      effects: {
        network: true,
        externalWrite: true,
        processExecution: false,
        guiAutomation: false
      },
      arguments: {
        url: 'https://user:password@example.test/publish?apiKey=top-secret&view=full',
        accessToken: 'token-value-must-not-survive',
        nested: {
          privateKey: 'private-key-material',
          authorization: 'Bearer abcdefghijklmnop'
        },
        path: '/outside/report.md'
      },
      workspace: '/workspace',
      cwd: '/workspace',
      exactFileTargets: ['/outside/report.md'],
      reason: 'external write using token=also-secret'
    })

    expect(ApprovalActionEnvelopeSchema.parse(action)).toEqual(action)
    expect(action).toMatchObject({
      version: 1,
      kind: 'file',
      toolName: 'mcp_call_tool',
      providerId: 'mcp:docs',
      providerKind: 'mcp',
      effects: {
        network: true,
        externalWrite: true,
        processExecution: false,
        guiAutomation: false
      }
    })
    expect(action.targets).toEqual(expect.arrayContaining([
      { kind: 'file', value: '/outside/report.md' },
      { kind: 'url', value: expect.stringContaining('apiKey=[redacted]') }
    ]))
    const serialized = JSON.stringify(action)
    expect(serialized).not.toContain('top-secret')
    expect(serialized).not.toContain('token-value-must-not-survive')
    expect(serialized).not.toContain('private-key-material')
    expect(serialized).not.toContain('abcdefghijklmnop')
    expect(serialized).not.toContain('also-secret')
    expect(serialized).not.toContain('user:password')
  })

  it.each([
    {
      expected: 'command',
      input: {
        toolName: 'bash',
        toolKind: 'command_execution' as const,
        arguments: { command: 'npm test' }
      }
    },
    {
      expected: 'network',
      input: {
        toolName: 'web_fetch',
        providerKind: 'web' as const,
        arguments: { url: 'https://example.test' }
      }
    },
    {
      expected: 'mcp',
      input: {
        toolName: 'search_docs',
        providerKind: 'mcp' as const,
        providerId: 'mcp:docs',
        arguments: { query: 'approval API' }
      }
    },
    {
      expected: 'external-effect',
      input: {
        toolName: 'send_message',
        providerKind: 'extension' as const,
        arguments: { recipient: 'team-room' }
      }
    }
  ])('classifies $expected actions and produces a bounded safe summary', ({ expected, input }) => {
    const action = createApprovalActionEnvelope({
      ...input,
      effects: {
        network: expected === 'network',
        externalWrite: false,
        processExecution: expected === 'command',
        guiAutomation: expected === 'external-effect'
      },
      workspace: '/workspace',
      reason: 'crossed the runtime approval boundary'
    })

    expect(action.kind).toBe(expected)
    expect(Buffer.byteLength(JSON.stringify(action.arguments), 'utf8')).toBeLessThanOrEqual(13_000)
    expect(Buffer.byteLength(safeApprovalActionSummary(action), 'utf8')).toBeLessThanOrEqual(2_048)
  })

  it('bounds deeply nested and oversized untrusted arguments', () => {
    const action = createApprovalActionEnvelope({
      toolName: 'oversized',
      arguments: {
        huge: 'x'.repeat(100_000),
        many: Array.from({ length: 100 }, (_, index) => ({
          index,
          child: { child: { child: { child: { value: 'too deep' } } } }
        }))
      },
      effects: {
        network: false,
        externalWrite: false,
        processExecution: false,
        guiAutomation: false
      },
      workspace: '/workspace',
      reason: 'unknown effect'
    })

    expect(ApprovalActionEnvelopeSchema.safeParse(action).success).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(action.arguments), 'utf8')).toBeLessThan(16_000)
    expect(JSON.stringify(action.arguments)).toContain('[truncated]')
    expect(action.arguments).toMatchObject({ __truncated__: true })
  })

  it('extracts critical targets from raw arguments even after the display budget is exhausted', () => {
    const arguments_: Record<string, unknown> = Object.fromEntries([
      ...Array.from({ length: 20 }, (_value, index) => [
        `padding_${index}`,
        'x'.repeat(2_000)
      ]),
      ['command', 'rm -rf ./generated-output'],
      ['path', '/workspace/generated-output'],
      ['url', 'https://example.test/publish'],
      ['recipient', 'release-room']
    ])
    const action = createApprovalActionEnvelope({
      toolName: 'compound_effect',
      toolKind: 'command_execution',
      effects: {
        network: true,
        externalWrite: true,
        processExecution: true,
        guiAutomation: false
      },
      arguments: arguments_,
      workspace: '/workspace',
      reason: 'compound action crossed the approval boundary'
    })

    expect(action.arguments).toMatchObject({ __truncated__: true })
    expect(action.arguments).not.toHaveProperty('command')
    expect(action.targets).toEqual(expect.arrayContaining([
      { kind: 'command', value: 'rm -rf ./generated-output' },
      { kind: 'file', value: '/workspace/generated-output' },
      { kind: 'url', value: 'https://example.test/publish' },
      { kind: 'recipient', value: 'release-room' }
    ]))
  })

  it('surfaces the exact Browser Use target binding in reviewer-readable targets', () => {
    const action = createApprovalActionEnvelope({
      toolName: 'browser_use',
      providerId: 'browserUse',
      providerKind: 'gui',
      arguments: {
        action: 'click',
        ref: 'opaque-reference-1234',
        expectedTarget: {
          sessionId: 'session-1234567890',
          tabId: 'tab-1',
          documentGeneration: 7,
          origin: 'https://accounts.example.test',
          sanitizedUrl: 'https://accounts.example.test/settings/security',
          role: 'button',
          name: 'Delete account'
        }
      },
      effects: {
        network: true,
        externalWrite: true,
        processExecution: false,
        guiAutomation: true
      },
      workspace: '/workspace',
      reason: 'browser interaction requires explicit approval'
    })

    expect(action.kind).toBe('external-effect')
    expect(action.targets).toEqual(expect.arrayContaining([
      {
        kind: 'url',
        value: 'https://accounts.example.test/settings/security'
      },
      {
        kind: 'url',
        value: 'https://accounts.example.test/'
      },
      {
        kind: 'resource',
        value: expect.stringContaining('"name":"Delete account"')
      }
    ]))
    expect(action.targets.find((target) => target.kind === 'resource')?.value)
      .toContain('"documentGeneration":7')
    expect(safeApprovalActionSummary(action)).toContain('Delete account')
  })

  it('summarizes a Browser Use batch as one reviewer-readable target', () => {
    const action = createApprovalActionEnvelope({
      toolName: 'browser_use',
      providerId: 'browserUse',
      providerKind: 'gui',
      arguments: {
        action: 'batch',
        steps: [
          { action: 'snapshot' },
          {
            action: 'type',
            ref: 'opaque-reference-1234',
            expectedTarget: {
              sessionId: 'session-1234567890',
              tabId: 'tab-1',
              documentGeneration: 7,
              origin: 'https://accounts.example.test',
              sanitizedUrl: 'https://accounts.example.test/form',
              role: 'textbox',
              name: 'Public note'
            },
            text: 'literal reviewer-secret'
          }
        ]
      },
      effects: {
        network: true,
        externalWrite: true,
        processExecution: false,
        guiAutomation: true
      },
      workspace: '/workspace',
      reason: 'browser interaction requires explicit approval'
    })

    expect(action.targets).toContainEqual({
      kind: 'resource',
      value: 'browser-batch 2 steps snapshotx1 typex1'
    })
    expect(JSON.stringify(action)).not.toContain('literal reviewer-secret')
  })

  it('keeps Browser Use query credentials and entered values out of review and audit data', () => {
    const open = createApprovalActionEnvelope({
      toolName: 'browser_use',
      providerId: 'browserUse',
      providerKind: 'gui',
      arguments: {
        action: 'open',
        url: 'https://example.test/callback?code=oauth-secret&signature=signed-secret#fragment'
      },
      workspace: '/workspace',
      reason: 'browser navigation requires explicit approval'
    })
    expect(open.arguments).toEqual({
      action: 'open',
      url: 'https://example.test/callback'
    })
    expect(open.targets).toContainEqual({
      kind: 'url',
      value: 'https://example.test/callback'
    })
    expect(JSON.stringify(open)).not.toContain('oauth-secret')
    expect(JSON.stringify(open)).not.toContain('signed-secret')
    expect(JSON.stringify(open)).not.toContain('fragment')

    const type = createApprovalActionEnvelope({
      toolName: 'browser_use',
      providerId: 'browserUse',
      providerKind: 'gui',
      arguments: {
        action: 'type',
        ref: 'opaque-reference-1234',
        expectedTarget: {
          sessionId: 'session-1234567890',
          tabId: 'tab-1',
          documentGeneration: 1,
          origin: 'https://example.test',
          sanitizedUrl: 'https://example.test/form',
          role: 'textbox',
          name: 'Public note'
        },
        text: 'literal reviewer-secret'
      },
      workspace: '/workspace',
      reason: 'browser text entry requires explicit approval'
    })
    expect(type.arguments).toMatchObject({
      action: 'type',
      text: '[redacted]',
      expectedTarget: { name: '[redacted]' }
    })
    expect(JSON.stringify(type)).not.toContain('literal reviewer-secret')
  })

  it('fails closed when security-critical targets cannot be represented completely', () => {
    expect(() => createApprovalActionEnvelope({
      toolName: 'oversized_command',
      toolKind: 'command_execution',
      arguments: { command: `echo ${'x'.repeat(3_000)}` },
      workspace: '/workspace',
      reason: 'oversized command'
    })).toThrow('command target exceeds')

    expect(() => createApprovalActionEnvelope({
      toolName: 'bulk_write',
      toolKind: 'file_change',
      arguments: {},
      exactFileTargets: Array.from(
        { length: 17 },
        (_value, index) => `/outside/${index}.txt`
      ),
      workspace: '/workspace',
      reason: 'too many exact file targets'
    })).toThrow('more than 16 distinct')
  })

  it('redacts environment credentials, GitHub tokens, and PEM private keys centrally', () => {
    const awsSecret = 'aws-secret-access-material-123456789'
    const awsAccessKeyId = 'AKIAIOSFODNN7EXAMPLE'
    const awsSessionToken = 'aws-session-token-material-123456789'
    const githubToken = 'ghp_abcdefghijklmnopqrstuvwxyz123456'
    const pemBody = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      pemBody,
      '-----END PRIVATE KEY-----'
    ].join('\n')
    const action = createApprovalActionEnvelope({
      toolName: 'bash',
      toolKind: 'command_execution',
      effects: {
        network: true,
        externalWrite: false,
        processExecution: true,
        guiAutomation: false
      },
      arguments: {
        awsAccessKeyId,
        awsSecretAccessKey: awsSecret,
        awsSessionToken,
        command: [
          `AWS_SECRET_ACCESS_KEY=${awsSecret}`,
          `aws configure set aws_access_key_id ${awsAccessKeyId}`,
          `aws configure set aws_session_token ${awsSessionToken}`,
          `GH_TOKEN=${githubToken}`,
          `PRIVATE_KEY='${pem}'`,
          `echo ${githubToken}`
        ].join(' ')
      },
      workspace: '/workspace',
      reason: `credential-bearing command ${githubToken}`
    })

    const serialized = JSON.stringify(action)
    expect(serialized).not.toContain(awsSecret)
    expect(serialized).not.toContain(awsAccessKeyId)
    expect(serialized).not.toContain(awsSessionToken)
    expect(serialized).not.toContain(githubToken)
    expect(serialized).not.toContain(pemBody)
    expect(serialized).not.toContain('BEGIN PRIVATE KEY')
    expect(serialized).toContain('AWS_SECRET_ACCESS_KEY=[redacted]')
    expect(serialized).toContain('GH_TOKEN=[redacted]')
    expect(action.targets).toEqual([
      expect.objectContaining({
        kind: 'command',
        value: expect.stringContaining('PRIVATE_KEY=[redacted]')
      })
    ])
  })

  it('redacts multiple PEM blocks and escaped quoted secrets without regexp backtracking', () => {
    const rsa = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'rsa-material',
      '-----END RSA PRIVATE KEY-----'
    ].join('\n')
    const ec = [
      '-----begin ec private key-----',
      'ec-material',
      '-----end ec private key-----'
    ].join('\n')
    const redacted = redactApprovalSensitiveText([
      rsa,
      'AWS_SECRET_ACCESS_KEY="escaped\\\\\\"secret"',
      'SERVICE_TOKEN=\'escaped\\\\\\\'secret\'',
      ec,
      '-----BEGIN PRIVATE KEY----- unmatched'
    ].join('\n'))

    expect(redacted).not.toContain('rsa-material')
    expect(redacted).not.toContain('ec-material')
    expect(redacted).toContain('[redacted private key]')
    expect(redacted).toContain('AWS_SECRET_ACCESS_KEY=[redacted]')
    expect(redacted).toContain('SERVICE_TOKEN=[redacted]')
    expect(redacted).toContain('-----BEGIN PRIVATE KEY----- unmatched')
  })
})
