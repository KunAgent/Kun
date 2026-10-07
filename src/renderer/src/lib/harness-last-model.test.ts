import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readHarnessLastModel, rememberHarnessLastModel } from './harness-last-model'

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  })
})

afterEach(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('harness last model', () => {
  it('remembers the last pick per Agent and credential path', () => {
    rememberHarnessLastModel('devin', 'native-login', 'gpt-5.3-codex-spark', '')
    rememberHarnessLastModel('devin', 'native-login', 'claude-sonnet', '')
    rememberHarnessLastModel('devin', 'provider', 'deepseek-chat', 'deepseek')
    expect(readHarnessLastModel('devin', 'native-login')).toEqual({ model: 'claude-sonnet', providerId: '' })
    expect(readHarnessLastModel('devin', 'provider')).toEqual({ model: 'deepseek-chat', providerId: 'deepseek' })
    expect(readHarnessLastModel('codex', 'native-login')).toBeUndefined()
  })

  it('ignores Kun and blank picks', () => {
    rememberHarnessLastModel('kun', '', 'deepseek-chat', 'deepseek')
    rememberHarnessLastModel('devin', 'native-login', '  ', '')
    expect(readHarnessLastModel('kun', '')).toBeUndefined()
    expect(readHarnessLastModel('devin', 'native-login')).toBeUndefined()
  })
})
