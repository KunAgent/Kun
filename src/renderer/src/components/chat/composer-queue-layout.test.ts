import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

// Layout rules a static render cannot see: they keep a queued row readable in
// a narrow tray (the 420px side conversation) instead of squeezing the text.
const css = readFileSync(
  resolve('src/renderer/src/components/chat/FloatingComposerQueuedMessages.module.css'),
  'utf8'
)

function rule(selector: string, source = css): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`))
  if (!match) throw new Error(`Missing CSS rule ${selector}`)
  return match[1]!
}

describe('composer queue row layout', () => {
  it('splits the row between text and meta so the text never gets less than half', () => {
    const text = rule('.text')
    const meta = rule('.meta')
    expect(text).toMatch(/flex: 1 1 0;/)
    expect(text).toMatch(/max-width: max-content;/)
    expect(meta).toMatch(/flex: 1 1 0;/)
    expect(meta).toMatch(/max-width: max-content;/)
    expect(meta).not.toMatch(/flex: 0 0 auto/)
  })

  it('drops meta items whole, by priority, instead of clipping them mid-glyph', () => {
    const meta = rule('.meta')
    expect(meta).toMatch(/flex-flow: row-reverse wrap;/)
    expect(meta).toMatch(/height: 20px;/)
    expect(meta).toMatch(/overflow: hidden;/)
    expect(rule('.status')).toMatch(/order: -2;/)
    expect(rule('.attachments')).toMatch(/order: -1;/)
    expect(rule('.badges')).toMatch(/display: contents;/)
    // A label that cannot fit ends in an ellipsis rather than a cut glyph.
    expect(rule('.statusLabel')).toMatch(/text-overflow: ellipsis;/)
    expect(rule('.statusLabel')).not.toMatch(/flex: none/)
  })

  it('moves the first row actions into the hover overlay when the tray is narrow', () => {
    const query = css.match(/@container composer-queue \(max-width: 480px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(rule('.dock')).toMatch(/container: composer-queue \/ inline-size;/)
    expect(rule(".row[data-first='true'] .actions", query)).toMatch(/position: absolute;/)
    expect(rule(".row[data-first='true'] .actions", query)).toMatch(/opacity: 0;/)
    expect(query).toMatch(/\.row\[data-first='true'\]:has\(:focus-visible\) \.actions/)
  })

  it('keeps the paused count outside the ellipsized reason', () => {
    expect(rule('.pausedCount')).toMatch(/flex: none;/)
    expect(rule('.pausedText')).toMatch(/min-width: 0;/)
  })
})
