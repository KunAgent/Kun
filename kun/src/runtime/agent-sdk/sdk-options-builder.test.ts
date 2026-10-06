import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SDK_BUILTIN_TOOLS,
  assembleSdkOptions,
  buildCanUseTool,
  buildClaudeSystemPrompt,
  buildScopedEnv,
  isAnthropicModel,
  mapApprovalPolicyToPermissionMode,
  resolveSdkModel
} from './sdk-options-builder.js'

describe('resolveSdkModel', () => {
  test('keeps a Claude thread model as-is', () => {
    expect(resolveSdkModel('claude-haiku-4-5', 'claude-opus-4-8')).toBe('claude-haiku-4-5')
    expect(isAnthropicModel('claude-sonnet-4-6')).toBe(true)
  })

  test('coerces a non-Anthropic thread model to the runtime default Claude model', () => {
    // the reported bug: an old deepseek thread routed to the subscription engine
    expect(resolveSdkModel('deepseek-v4-flash', 'claude-haiku-4-5')).toBe('claude-haiku-4-5')
    expect(isAnthropicModel('deepseek-v4-flash')).toBe(false)
  })

  test('falls back to undefined when neither model is a Claude id', () => {
    expect(resolveSdkModel('deepseek-v4-flash', 'gpt-5')).toBeUndefined()
    expect(resolveSdkModel(undefined, undefined)).toBeUndefined()
  })

  test('passes kun/<provider>/<model> gateway addresses through untouched', () => {
    expect(resolveSdkModel('kun/anthropic-sub/claude-sonnet-4-6', 'claude-haiku-4-5'))
      .toBe('kun/anthropic-sub/claude-sonnet-4-6')
    expect(resolveSdkModel(undefined, 'kun/p/m')).toBe('kun/p/m')
    // A model id with slashes but no kun/ prefix is still not a gateway id.
    expect(resolveSdkModel('vendor/claude-x', 'kun/p/m')).toBe('kun/p/m')
  })
})

describe('buildScopedEnv', () => {
  test('strips auth overrides and injects the OAuth token', () => {
    const env = buildScopedEnv(
      {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        ANTHROPIC_AUTH_TOKEN: 'tok',
        ANTHROPIC_BASE_URL: 'https://proxy',
        CLAUDE_CODE_USE_BEDROCK: '1',
        KUN_BROWSER_USE_BRIDGE_URL: 'http://127.0.0.1:12345',
        KUN_BROWSER_USE_BRIDGE_TOKEN: 'bridge-token',
        kun_browser_use_approval_signing_key: 'signing-key'
      },
      'sk-ant-oat01-yyy'
    )
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.KUN_BROWSER_USE_BRIDGE_URL).toBeUndefined()
    expect(env.KUN_BROWSER_USE_BRIDGE_TOKEN).toBeUndefined()
    expect(env.kun_browser_use_approval_signing_key).toBeUndefined()
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
    buildScopedEnv(base, 'sk-ant-oat01-valid')
    expect(base.ANTHROPIC_API_KEY).toBe('k')
  })

  test('gateway mode strips provider credentials and injects only the scoped grant', () => {
    const env = buildScopedEnv(
      {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        CLAUDE_CODE_OAUTH_TOKEN: 'oat-token',
        ANTHROPIC_BASE_URL: 'https://upstream',
        CLAUDE_CODE_USE_BEDROCK: '1'
      },
      'sk-ant-oat01-should-not-be-used',
      {
        baseUrl: 'http://127.0.0.1:18899',
        token: 'kgw_abc.sig',
        model: 'kun/p/m',
        smallModel: 'kun/p/small',
        env: {
          baseUrl: 'ANTHROPIC_BASE_URL',
          token: 'ANTHROPIC_AUTH_TOKEN',
          model: 'ANTHROPIC_MODEL',
          smallModel: 'ANTHROPIC_SMALL_FAST_MODEL'
        },
        stripEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK']
      }
    )
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:18899')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('kgw_abc.sig')
    expect(env.ANTHROPIC_MODEL).toBe('kun/p/m')
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('kun/p/small')
    // OAuth + provider credentials are gone; the strip list wins over the token arg.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  test('rejects wrapped or malformed setup tokens without echoing the secret', () => {
    const raw = 'Bearer sk-ant-oat01-should-not-leak'
    expect(() => buildScopedEnv({}, raw)).toThrow(
      'Claude subscription token format is invalid'
    )
    try {
      buildScopedEnv({}, raw)
    } catch (error) {
      expect(String(error)).not.toContain('sk-ant-oat01-should-not-leak')
    }
  })
})

describe('mapApprovalPolicyToPermissionMode', () => {
  test('plan turn -> plan', () => {
    expect(mapApprovalPolicyToPermissionMode('auto', true)).toBe('plan')
  })
  test('auto -> bypassPermissions', () => {
    expect(mapApprovalPolicyToPermissionMode('auto')).toBe('default')
    expect(mapApprovalPolicyToPermissionMode('auto', false, 'danger-full-access')).toBe('bypassPermissions')
  })
  test('auto with a sandboxed filesystem still uses per-tool gating', () => {
    expect(mapApprovalPolicyToPermissionMode('auto', false, 'workspace-write')).toBe('default')
    expect(mapApprovalPolicyToPermissionMode('auto', false, 'read-only')).toBe('default')
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
    // updatedInput must always be present (SDK runtime schema requires it);
    // when kun doesn't rewrite, it echoes the original input through.
    const allow = buildCanUseTool(() => ({ allow: true }))
    expect(await allow('Bash', { command: 'ls' })).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls' }
    })

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

  test('deny without a message gets a default (SDK requires a non-empty message)', async () => {
    const deny = buildCanUseTool(() => ({ allow: false }))
    const result = await deny('Bash', {})
    expect(result.behavior).toBe('deny')
    expect((result as { message: string }).message).toBeTruthy()
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

  test('advertises SDK built-ins without auto-allowing them in restricted modes', () => {
    const opts = assembleSdkOptions(base)
    expect(opts.tools).toEqual(DEFAULT_SDK_BUILTIN_TOOLS)
    expect(opts.allowedTools).toEqual(base.bridgedToolModelNames)
    expect(opts.includePartialMessages).toBe(true)
    expect(opts.permissionMode).toBe('default')
    expect((opts.systemPrompt as { append: string }).append).toBe('You are kun.')
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(opts.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-z')
    expect(opts.settingSources).toEqual([])
  })

  test('allowSdkBuiltins:false disables the built-in catalog and yields only bridged tools', () => {
    const opts = assembleSdkOptions({ ...base, allowSdkBuiltins: false })
    expect(opts.tools).toEqual([])
    expect(opts.strictMcpConfig).toBe(true)
    expect(opts.allowedTools).toEqual(base.bridgedToolModelNames)
  })

  test('auto-allows native built-ins only for the complete Full access mapping', () => {
    const full = assembleSdkOptions({
      ...base,
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
    expect(full.permissionMode).toBe('bypassPermissions')
    expect(full.tools).toEqual(DEFAULT_SDK_BUILTIN_TOOLS)
    expect(full.allowedTools).toEqual([
      ...DEFAULT_SDK_BUILTIN_TOOLS,
      ...base.bridgedToolModelNames
    ])

    const incomplete = assembleSdkOptions({
      ...base,
      approvalPolicy: 'auto',
      sandboxMode: undefined
    })
    expect(incomplete.permissionMode).toBe('default')
    expect(incomplete.allowedTools).toEqual(base.bridgedToolModelNames)
  })

  test('optional fields only present when provided', () => {
    const opts = assembleSdkOptions(base)
    expect('model' in opts).toBe(false)
    expect('resume' in opts).toBe(false)
    const withExtras = assembleSdkOptions({ ...base, model: 'claude-opus-4-8', resume: 'sess_1' })
    expect(withExtras.model).toBe('claude-opus-4-8')
    expect(withExtras.resume).toBe('sess_1')
  })

  test('maps the native model-step ceiling to a finite SDK maxTurns option', () => {
    expect(assembleSdkOptions({ ...base, maxTurns: 7 }).maxTurns).toBe(7)
    expect(assembleSdkOptions({ ...base, maxTurns: 2.9 }).maxTurns).toBe(2)
    expect(assembleSdkOptions(base).maxTurns).toBeUndefined()
  })

  test('gateway turns keep reasoning through gateway-signed thinking and honor an explicit off', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:18899', token: 'fixture', model: 'kun/p/m',
      env: { baseUrl: 'ANTHROPIC_BASE_URL', token: 'ANTHROPIC_AUTH_TOKEN' }, stripEnv: [] }
    const off = assembleSdkOptions({ ...base, gateway, reasoningEffort: 'off' })
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off.effort).toBeUndefined()
    const high = assembleSdkOptions({ ...base, gateway, reasoningEffort: 'high' })
    expect(high).toMatchObject({ effort: 'high', thinking: { type: 'adaptive' } })
    expect(high.env?.MAX_THINKING_TOKENS).toBeUndefined()
    expect(high.env?.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined()
  })

  test('maps Claude subscription effort to adaptive-thinking SDK options', () => {
    expect(assembleSdkOptions({ ...base, reasoningEffort: 'low' })).toMatchObject({
      effort: 'low',
      thinking: { type: 'adaptive' }
    })
    expect(assembleSdkOptions({ ...base, reasoningEffort: 'max' })).toMatchObject({
      effort: 'max',
      thinking: { type: 'adaptive' }
    })
    expect(assembleSdkOptions({ ...base, reasoningEffort: 'off' })).not.toHaveProperty('effort')
  })
})
