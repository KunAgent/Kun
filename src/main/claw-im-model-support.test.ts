import { describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  imRuntimeStartError,
  isMissingThreadResult,
  runtimeErrorCode
} from './claw-im-model-support'

const zh = { locale: 'zh-CN' } as unknown as AppSettingsV1

describe('IM runtime error mapping', () => {
  it('uses structured codes to distinguish missing and closing threads', () => {
    const missing = {
      ok: false,
      status: 404,
      body: JSON.stringify({ code: 'not_found', message: 'thread not found: thr_1' })
    }
    const closing = {
      ok: false,
      status: 409,
      body: JSON.stringify({ code: 'thread_closing', message: 'thread is closing: thr_1' })
    }

    expect(runtimeErrorCode(missing)).toBe('not_found')
    expect(isMissingThreadResult(missing)).toBe(true)
    expect(isMissingThreadResult(closing)).toBe(false)
    expect(imRuntimeStartError(zh, closing, 'fallback')).toBe('当前会话正在关闭，请稍后重试。')
  })
})
