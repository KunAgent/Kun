import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SDK_BUILTIN_TOOLS,
  assembleSdkOptions,
  buildCanUseTool,
  buildClaudeSystemPrompt,
  buildScopedEnv,
  mapApprovalPolicyToPermissionMode
} from './sdk-options-builder.js'

describe('buildScopedEnv', () => {
  test('strips auth overrides and injects the OAuth token', () => {
    const env = buildScopedEnv(
      {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        ANTHROPIC_AUTH_TOKEN: 'tok',
        ANTHROPIC_BASE_URL: 'https://proxy',
        CLAUDE_CODE_USE_BEDROCK: '1'
      },
      'sk-ant-oat01-yyy'
    )
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-yyy')
  })

  test('without a token, still strips overrides but sets nothing (rely on Claude Code login)', () => {
    const env = buildScopedEnv({ ANTHROPIC_API_KEY: 'k' })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('does not mutate the input env', () => {
    const base = { ANTHROPIC_API_KEY: 'k' }
    buildScopedEnv(base, 't')
    expect(base.ANTHROPIC_API_KEY).toBe('k')
  })
})

describe('mapApprovalPolicyToPermissionMode', () => {
  test('plan turn -> plan', () => {
    expect(mapApprovalPolicyToPermissionMode('auto', true)).toBe('plan')
  })
  test('auto -> bypassPermissions', () => {
    expect(mapApprovalPolicyToPermissionMode('auto')).toBe('bypassPermissions')
  })
  test('gated policies -> default', () => {
    expect(mapApprovalPolicyToPermissionMode('always')).toBe('default')
    expect(mapApprovalPolicyToPermissionMode('on-request')).toBe('default')
    expect(mapApprovalPolicyToPermissionMode('never')).toBe('default')
  })
})

describe('buildClaudeSystemPrompt', () => {
  test('appends kun persona onto the claude_code preset', () => {
    const sp = buildClaudeSystemPrompt('You are kun.', 'Persona: terse.')
    expect(sp).toEqual({ type: 'preset', preset: 'claude_code', append: 'You are kun.\n\nPersona: terse.' })
  })
  test('omits persona when absent', () => {
    expect(buildClaudeSystemPrompt('You are kun.').append).toBe('You are kun.')
  })
})

describe('buildCanUseTool', () => {
  test('allow passes through, with optional updatedInput', async () => {
    const allow = buildCanUseTool(() => ({ allow: true }))
    expect(await allow('Bash', { command: 'ls' })).toEqual({ behavior: 'allow' })

    const rewrite = buildCanUseTool(() => ({ allow: true, updatedInput: { command: 'ls -la' } }))
    expect(await rewrite('Bash', { command: 'ls' })).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls -la' }
    })
  })

  test('deny carries the message', async () => {
    const deny = buildCanUseTool(() => ({ allow: false, message: 'blocked by user' }))
    expect(await deny('Bash', {})).toEqual({ behavior: 'deny', message: 'blocked by user' })
  })

  test('a throwing decider denies closed', async () => {
    const boom = buildCanUseTool(() => {
      throw new Error('gate down')
    })
    expect(await boom('Bash', {})).toEqual({ behavior: 'deny', message: 'gate down' })
  })
})

describe('assembleSdkOptions', () => {
  const base = {
    cwd: '/ws',
    kunSystemPrompt: 'You are kun.',
    approvalPolicy: 'on-request' as const,
    bridgedToolModelNames: ['mcp__kun__generate_image', 'mcp__kun__memory_create'],
    baseEnv: { ANTHROPIC_API_KEY: 'k', PATH: '/bin' },
    oauthToken: 'sk-ant-oat01-z'
  }

  test('unions SDK built-ins with bridged kun tools and turns on partial streaming', () => {
    const opts = assembleSdkOptions(base)
    expect(opts.allowedTools).toEqual([...DEFAULT_SDK_BUILTIN_TOOLS, ...base.bridgedToolModelNames])
    expect(opts.includePartialMessages).toBe(true)
    expect(opts.permissionMode).toBe('default')
    expect((opts.systemPrompt as { append: string }).append).toBe('You are kun.')
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(opts.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-z')
    expect(opts.settingSources).toEqual([])
  })

  test('allowSdkBuiltins:false yields only bridged tools', () => {
    const opts = assembleSdkOptions({ ...base, allowSdkBuiltins: false })
    expect(opts.allowedTools).toEqual(base.bridgedToolModelNames)
  })

  test('optional fields only present when provided', () => {
    const opts = assembleSdkOptions(base)
    expect('model' in opts).toBe(false)
    expect('resume' in opts).toBe(false)
    const withExtras = assembleSdkOptions({ ...base, model: 'claude-opus-4-8', resume: 'sess_1' })
    expect(withExtras.model).toBe('claude-opus-4-8')
    expect(withExtras.resume).toBe('sess_1')
  })
})
