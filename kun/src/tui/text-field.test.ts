import { describe, expect, it } from 'vitest'
import { key, keys, typeText } from './keys.test-support.js'
import { TextField } from './text-field.js'

describe('TextField', () => {
  it('edits at the cursor and reports navigation keys as unhandled', () => {
    const field = new TextField()
    typeText(field, 'helo')
    field.handleKey(keys.left)
    typeText(field, 'l')
    expect(field.getValue()).toBe('hello')
    expect(field.parts()).toEqual({ before: 'hell', after: 'o' })
    expect(field.handleKey(keys.up)).toBe(false)
    expect(field.handleKey(keys.enter)).toBe(false)
  })

  it('treats wide characters and emoji as single cursor units', () => {
    const field = new TextField('中文👍🏽')
    field.handleKey(keys.backspace)
    expect(field.getValue()).toBe('中文')
    field.handleKey(keys.left)
    expect(field.parts()).toEqual({ before: '中', after: '文' })
  })

  it('supports line-editing shortcuts', () => {
    const field = new TextField('alpha beta gamma')
    field.handleKey(key('\x17')) // Ctrl+W
    expect(field.getValue()).toBe('alpha beta ')
    field.handleKey(key('\x01')) // Ctrl+A
    field.handleKey(key('\x0b')) // Ctrl+K
    expect(field.getValue()).toBe('')
    field.insert('one two')
    field.handleKey(key('\x15')) // Ctrl+U
    expect(field.getValue()).toBe('')
  })

  it('keeps pasted text on one line without terminal controls', () => {
    const field = new TextField()
    field.insert('a\nb\x1b[31mc')
    expect(field.getValue()).toBe('a bc')
  })
})
