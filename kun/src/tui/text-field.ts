import { isKey, printableText, type TuiKeyEvent } from './keys.js'
import { sanitizeTerminalText } from './layout.js'

/**
 * Single-line editable value used by page search boxes and form steps. The
 * cursor is a grapheme index so wide CJK text and emoji edit as one unit.
 */
export class TextField {
  private chars: string[] = []
  private cursorIndex = 0

  constructor(initial = '') {
    this.setValue(initial)
  }

  getValue(): string {
    return this.chars.join('')
  }

  setValue(value: string): void {
    this.chars = graphemes(singleLine(value))
    this.cursorIndex = this.chars.length
  }

  get cursor(): number {
    return this.cursorIndex
  }

  /** Text before and after the cursor, for rendering a caret. */
  parts(): { before: string; after: string } {
    return {
      before: this.chars.slice(0, this.cursorIndex).join(''),
      after: this.chars.slice(this.cursorIndex).join('')
    }
  }

  insert(text: string): void {
    const inserted = graphemes(singleLine(text))
    if (!inserted.length) return
    this.chars.splice(this.cursorIndex, 0, ...inserted)
    this.cursorIndex += inserted.length
  }

  clear(): void {
    this.chars = []
    this.cursorIndex = 0
  }

  /**
   * Apply an editing key. Returns true when the key was an edit or cursor
   * movement, so callers can treat everything else as navigation.
   */
  handleKey(key: TuiKeyEvent): boolean {
    if (isKey(key, 'backspace', 'shift+backspace')) {
      if (this.cursorIndex > 0) {
        this.chars.splice(this.cursorIndex - 1, 1)
        this.cursorIndex -= 1
      }
      return true
    }
    if (isKey(key, 'delete', 'ctrl+d')) {
      if (this.cursorIndex < this.chars.length) this.chars.splice(this.cursorIndex, 1)
      return true
    }
    if (isKey(key, 'left', 'ctrl+b')) {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1)
      return true
    }
    if (isKey(key, 'right', 'ctrl+f')) {
      this.cursorIndex = Math.min(this.chars.length, this.cursorIndex + 1)
      return true
    }
    if (isKey(key, 'home', 'ctrl+a')) {
      this.cursorIndex = 0
      return true
    }
    if (isKey(key, 'end', 'ctrl+e')) {
      this.cursorIndex = this.chars.length
      return true
    }
    if (isKey(key, 'ctrl+u')) {
      this.chars.splice(0, this.cursorIndex)
      this.cursorIndex = 0
      return true
    }
    if (isKey(key, 'ctrl+k')) {
      this.chars.splice(this.cursorIndex)
      return true
    }
    if (isKey(key, 'ctrl+w', 'alt+backspace', 'ctrl+backspace')) {
      let start = this.cursorIndex
      while (start > 0 && /\s/u.test(this.chars[start - 1]!)) start -= 1
      while (start > 0 && !/\s/u.test(this.chars[start - 1]!)) start -= 1
      this.chars.splice(start, this.cursorIndex - start)
      this.cursorIndex = start
      return true
    }
    if (isKey(key, 'alt+left', 'ctrl+left')) {
      let index = this.cursorIndex
      while (index > 0 && /\s/u.test(this.chars[index - 1]!)) index -= 1
      while (index > 0 && !/\s/u.test(this.chars[index - 1]!)) index -= 1
      this.cursorIndex = index
      return true
    }
    if (isKey(key, 'alt+right', 'ctrl+right')) {
      let index = this.cursorIndex
      while (index < this.chars.length && /\s/u.test(this.chars[index]!)) index += 1
      while (index < this.chars.length && !/\s/u.test(this.chars[index]!)) index += 1
      this.cursorIndex = index
      return true
    }
    const text = printableText(key)
    if (text === undefined) return false
    this.insert(text)
    return true
  }
}

function singleLine(value: string): string {
  return sanitizeTerminalText(value).replace(/[\r\n]+/gu, ' ')
}

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined

function graphemes(value: string): string[] {
  return segmenter
    ? Array.from(segmenter.segment(value), (part) => part.segment)
    : Array.from(value)
}
