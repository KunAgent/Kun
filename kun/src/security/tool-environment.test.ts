import { describe, expect, it } from 'vitest'
import { sanitizeToolEnvironment } from './tool-environment.js'

describe('sanitizeToolEnvironment', () => {
  it('removes credentials, credential paths, and runtime control variables', () => {
    const result = sanitizeToolEnvironment({
      PATH: 'bin',
      OPENAI_API_KEY: 'secret',
      KUN_RUNTIME_TOKEN: 'runtime-secret',
      GOOGLE_APPLICATION_CREDENTIALS: 'C:/secret.json',
      ELECTRON_RUN_AS_NODE: '1',
      DEBUG_PORT: '9229',
      LANG: 'en_US.UTF-8'
    })

    expect(result.env).toEqual({ PATH: 'bin', LANG: 'en_US.UTF-8' })
    expect(result.removedKeys).toEqual([
      'DEBUG_PORT',
      'ELECTRON_RUN_AS_NODE',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'KUN_RUNTIME_TOKEN',
      'OPENAI_API_KEY'
    ])
  })

  it('removes proxy credentials but keeps a proxy without userinfo', () => {
    const result = sanitizeToolEnvironment({
      HTTP_PROXY: 'http://proxy.example:8080',
      HTTPS_PROXY: 'https://user:password@proxy.example:8443',
      NO_PROXY: 'localhost,127.0.0.1'
    })

    expect(result.env).toEqual({
      HTTP_PROXY: 'http://proxy.example:8080',
      NO_PROXY: 'localhost,127.0.0.1'
    })
    expect(result.removedKeys).toEqual(['HTTPS_PROXY'])
  })

  it('allows an explicitly approved key and does not expose values in audit output', () => {
    const result = sanitizeToolEnvironment(
      { provider_api_key: 'intentional', OTHER_SECRET: 'hidden' },
      { allowKeys: ['PROVIDER_API_KEY'] }
    )

    expect(result.env).toEqual({ provider_api_key: 'intentional' })
    expect(result.removedKeys).toEqual(['OTHER_SECRET'])
    expect(JSON.stringify(result.removedKeys)).not.toContain('hidden')
  })

  it('ignores undefined values and keeps ordinary variables', () => {
    expect(sanitizeToolEnvironment({ HOME: '/home/user', EMPTY: undefined })).toEqual({
      env: { HOME: '/home/user' },
      removedKeys: []
    })
  })
})
