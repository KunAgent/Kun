import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from './format-runtime-error'

describe('format runtime error', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('uses code fields for localized summaries and settings actions', () => {
    const error = new Error(JSON.stringify({
      code: 'missing_api_key',
      message: 'api-key=sk-test is missing',
      details: { Authorization: 'Bearer runtime-token' }
    }))

    const view = describeRuntimeError(error)

    expect(view.summary).toBe(i18n.t('common:runtimeMissingApiKey'))
    expect(view.message).toBe('api-key=<redacted> is missing')
    expect(view.code).toBe('missing_api_key')
    expect(view.settingsAction).toBe('agents')
    expect(view.detail).toContain('<redacted>')
    expect(view.detail).not.toContain('sk-test')
    expect(view.detail).not.toContain('runtime-token')
  })

  it('supports legacy error envelopes and Electron IPC prefixes', () => {
    const error = new Error(
      `Error invoking remote method 'runtime:request': Error: ${JSON.stringify({
        error: 'fetch_failed',
        message: 'fetch failed'
      })}`
    )

    expect(getRuntimeErrorCode(error)).toBe('fetch_failed')
    expect(formatRuntimeError(error)).toBe(i18n.t('common:runtimeFetchFailed'))
  })

  it('classifies upstream model request failures separately from local runtime fetch failures', () => {
    const error = new Error(JSON.stringify({
      message: 'model request failed: fetch failed',
      severity: 'error'
    }))

    expect(getRuntimeErrorCode(error)).toBe('model_request_failed')
    expect(formatRuntimeError(error)).toBe(i18n.t('common:runtimeModelRequestFailed'))
    expect(formatRuntimeError(error)).not.toBe(i18n.t('common:runtimeFetchFailed'))
  })

  it('explains when no supplier response was received and keeps the network cause in details', () => {
    const view = describeRuntimeError(new Error(JSON.stringify({
      code: 'model_provider_unreachable',
      message: 'model provider did not return a response from https://api.luna.example/v1/chat/completions: fetch failed → getaddrinfo ENOTFOUND api.luna.example',
      severity: 'error'
    })))

    expect(view.summary).toBe(i18n.t('common:runtimeModelProviderNoResponse'))
    expect(view.message).toBe(view.summary)
    expect(view.detail).toContain('getaddrinfo ENOTFOUND api.luna.example')
  })

  it('explains stream disconnects as transport interruptions, not provider errors', () => {
    const view = describeRuntimeError(new Error(JSON.stringify({
      code: 'stream_disconnected',
      message: 'stream closed before response.completed',
      severity: 'error'
    })))

    expect(view.code).toBe('stream_disconnected')
    expect(view.summary).toBe(i18n.t('common:runtimeStreamDisconnected'))
    expect(view.message).toBe(view.summary)
    expect(view.message).not.toContain('response.completed')
    expect(view.detail).toContain('stream closed before response.completed')
  })

  it('classifies gateway disconnect wording even without an explicit code', () => {
    const view = describeRuntimeError(new Error(JSON.stringify({
      message: 'stream closed before response.completed'
    })))

    expect(view.code).toBeUndefined()
    expect(view.summary).toBe(i18n.t('common:runtimeStreamDisconnected'))
    expect(view.message).not.toContain('response.completed')
  })

  it('routes fixed-sampling provider errors to Agents settings for recovery', () => {
    const view = describeRuntimeError(new Error(JSON.stringify({
      code: 'http_400',
      message: 'model request failed with status 400: invalid temperature: only 1 is allowed for this model'
    })))

    expect(view.settingsAction).toBe('agents')
  })

  it('localizes thread_busy without exposing its runtime owner in the primary message', () => {
    const owner = 'af197738-2317-49bb-b9b0-d6d5e7b24cdd'
    const view = describeRuntimeError(new Error(JSON.stringify({
      code: 'thread_busy',
      message: `thread thr_1 is busy in production/${owner}`
    })))

    expect(view.code).toBe('thread_busy')
    expect(view.summary).toBe(i18n.t('common:runtimeActiveTurn'))
    expect(view.message).toBe(i18n.t('common:runtimeActiveTurn'))
    expect(view.message).not.toContain(owner)
    expect(view.detail).not.toContain(owner)
  })

  it('keeps raw provider messages visible in details even when the summary is the same text', () => {
    const message = `model request failed with status 400: ${JSON.stringify({
      error: {
        code: '400',
        message: `Not supported model ${'mimo-v2.5-pro-ultraspeed'.repeat(20)}`
      }
    })}`
    const error = new Error(JSON.stringify({
      code: 'http_400',
      message,
      severity: 'error'
    }))

    const view = describeRuntimeError(error)

    expect(view.summary).toBe(message)
    expect(view.message).toBe(message)
    expect(view.detail).toContain('Code: http_400')
    expect(view.detail).toContain('Severity: error')
    expect(view.detail).toContain(`Message:\n${message}`)
  })
})
