import type { TuiController } from '../controller.js'
import { isCancelKey, isKey, letter, printableText, type TuiKeyEvent } from '../keys.js'
import { PageScrollState, type PageMouseEvent, type PageView, type TuiPage } from '../page-model.js'
import { sanitizeTerminalText } from '../safe-text.js'
import type { ThreadProjection } from '../state.js'
import { visual } from '../visual-system.js'
import type { Invalidate } from './page-kit.js'

const { muted: dim, success: green } = visual

/**
 * Full transcript of the current session with tool inputs/outputs and
 * per-item Thinking toggles. Finished turns live in the terminal scrollback
 * as immutable text; this page is where they become explorable again.
 */
export class TranscriptPage implements TuiPage {
  readonly kind = 'transcript'
  private projection?: ThreadProjection
  private showReasoning: boolean
  private showToolDetails = true
  private readonly reasoningOverrides = new Map<string, boolean>()
  private readonly scroll = new PageScrollState()

  constructor(
    controller: TuiController,
    showReasoning: boolean,
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    this.projection = controller.state.projection
    this.showReasoning = showReasoning
  }

  update(projection: ThreadProjection | undefined): void {
    if (projection && this.projection && projection.thread.id !== this.projection.thread.id) {
      this.reasoningOverrides.clear()
      this.scroll.follow = true
    }
    this.projection = projection
    this.invalidate()
  }

  get animated(): boolean {
    return Boolean(this.projection?.runningTurnId)
  }

  view(): PageView {
    const title = this.projection ? sanitizeTerminalText(this.projection.thread.title || 'Untitled') : 'No session'
    const running = Boolean(this.projection?.runningTurnId)
    return {
      path: ['KUN', 'Transcript', title],
      right: `${this.showToolDetails ? 'details' : 'compact'} · Thinking ${this.showReasoning ? 'expanded' : 'collapsed'}`,
      body: [{
        kind: 'transcript',
        transcript: {
          ...(this.projection ? { projection: this.projection } : {}),
          showReasoning: this.showReasoning,
          showToolDetails: this.showToolDetails,
          reasoningOverrides: this.reasoningOverrides,
          toggleReasoning: (itemId) => {
            this.reasoningOverrides.set(itemId, !(this.reasoningOverrides.get(itemId) ?? this.showReasoning))
            this.invalidate()
          },
          scroll: this.scroll,
          ...(!this.projection?.items.length ? { placeholder: [dim(' This session has no messages yet.')] } : {})
        }
      }],
      status: { left: running ? ` ${green('● live')}` : ` ${dim('● idle')}`, right: dim(this.scroll.label()) },
      footer: [
        { key: '↑/↓ PgUp/PgDn', label: 'scroll' },
        { key: 'T', label: `${this.showReasoning ? 'collapse' : 'expand'} Thinking` },
        { key: 'D', label: this.showToolDetails ? 'compact tools' : 'tool details' },
        { key: 'Click', label: 'toggle one Thinking' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (isCancelKey(key)) { this.close(); return }
    const char = printableText(key)
    if (letter(key) === 't') {
      this.showReasoning = !this.showReasoning
      this.reasoningOverrides.clear()
    } else if (letter(key) === 'd') this.showToolDetails = !this.showToolDetails
    else if (isKey(key, 'up') || char === 'k') this.scroll.scrollBy(-1)
    else if (isKey(key, 'down') || char === 'j') this.scroll.scrollBy(1)
    else if (isKey(key, 'pageUp', 'ctrl+u')) this.scroll.scrollBy(-this.scroll.page())
    else if (isKey(key, 'pageDown', 'ctrl+d', 'space')) this.scroll.scrollBy(this.scroll.page())
    else if (isKey(key, 'home') || char === 'g') this.scroll.scrollTo(0)
    else if (isKey(key, 'end') || char === 'G') this.scroll.scrollTo(this.scroll.maxOffset())
    else return
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type !== 'scroll') return
    this.scroll.scrollBy(event.delta)
    this.invalidate()
  }
}
