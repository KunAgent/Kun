import { describe, expect, it } from 'vitest'
import { shellSpawnEnv } from '../../adapters/tool/builtin-shell-utils.js'
import { buildScopedEnv } from './sdk-options-builder.js'
import { sdkProcessBaseEnv, withLoopbackProxyBypass } from './sdk-process-environment.js'

describe('native SDK process environment', () => {
  it('preserves explicit upper and lower case proxy variables without unrelated secrets', () => {
    const source = {
      PATH: '/usr/bin', HOME: '/home/user',
      HTTP_PROXY: 'http://proxy.invalid:8080', HTTPS_PROXY: 'http://proxy.invalid:8081',
      ALL_PROXY: 'socks5://proxy.invalid:1080', NO_PROXY: 'private.test',
      http_proxy: 'http://lower.invalid:8080', https_proxy: 'http://lower.invalid:8081',
      all_proxy: 'socks5://lower.invalid:1080', no_proxy: 'other.test',
      DEEPSEEK_API_KEY: 'unrelated-model-secret', ANTHROPIC_API_KEY: 'wrong-provider-secret',
      KUN_RUNTIME_TOKEN: 'runtime-secret', AWS_SECRET_ACCESS_KEY: 'unrelated-cloud-secret'
    }
    expect(sdkProcessBaseEnv(source, 'darwin')).toEqual({
      PATH: source.PATH, HOME: source.HOME,
      HTTP_PROXY: source.HTTP_PROXY, HTTPS_PROXY: source.HTTPS_PROXY,
      ALL_PROXY: source.ALL_PROXY, NO_PROXY: source.NO_PROXY,
      http_proxy: source.http_proxy, https_proxy: source.https_proxy,
      all_proxy: source.all_proxy, no_proxy: source.no_proxy
    })
    // This correction applies to native agent startup, not arbitrary shell tools.
    expect(shellSpawnEnv(source, 'darwin').HTTPS_PROXY).toBeUndefined()
    expect(source.KUN_RUNTIME_TOKEN).toBe('runtime-secret')
  })

  it('accepts Windows case-insensitive proxy names and still scrubs unrelated names', () => {
    const env = sdkProcessBaseEnv({ Https_Proxy: 'http://proxy.invalid:8080',
      No_Proxy: 'private.test', Other_Secret: 'secret' }, 'win32')
    expect(env.Https_Proxy).toBe('http://proxy.invalid:8080')
    expect(env.No_Proxy).toBe('private.test')
    expect(env.Other_Secret).toBeUndefined()
  })

  it('leaves a native login route proxy and bypass preferences unchanged', () => {
    const base = sdkProcessBaseEnv({ HTTPS_PROXY: 'http://proxy.invalid:8080', NO_PROXY: 'private.test' })
    expect(buildScopedEnv(base)).toEqual(base)
    expect(buildScopedEnv(base).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  it('preserves both bypass lists and always bypasses the local authenticated gateway', () => {
    const base = { HTTPS_PROXY: 'http://proxy.invalid:8080', NO_PROXY: 'private.test,localhost',
      no_proxy: 'other.test, 10.0.0.0/8', ANTHROPIC_API_KEY: 'wrong-key' }
    const env = buildScopedEnv(base, undefined, {
      baseUrl: 'http://127.0.0.1:18899', token: 'gateway-token', model: 'kun/test/model',
      env: { baseUrl: 'ANTHROPIC_BASE_URL', token: 'ANTHROPIC_AUTH_TOKEN' },
      stripEnv: ['ANTHROPIC_API_KEY']
    })
    expect(env.HTTPS_PROXY).toBe(base.HTTPS_PROXY)
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:18899')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('gateway-token')
    expect(env.no_proxy).toBe(env.NO_PROXY)
    expect(env.NO_PROXY?.split(',')).toEqual([
      'private.test', 'localhost', 'other.test', '10.0.0.0/8', '127.0.0.1', '::1', '[::1]'
    ])
    expect(base.NO_PROXY).toBe('private.test,localhost')
    expect(base.no_proxy).toBe('other.test, 10.0.0.0/8')
  })

  it('retains wildcard bypass and does not duplicate loopback on repeated composition', () => {
    const env = withLoopbackProxyBypass({ no_proxy: '*' })
    expect(env.NO_PROXY).toBe('*,localhost,127.0.0.1,::1,[::1]')
    expect(withLoopbackProxyBypass(env)).toEqual(env)
  })
})
