import { Prec, StateEffect, StateField } from '@codemirror/state'
import type { Extension, EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import { buildInlineCompletionRequestContext } from './context'
import {
  INLINE_COMPLETION_DEBOUNCE_MS,
  INLINE_LONG_COMPLETION_DEBOUNCE_MS
} from './constants'
import { evaluateInlineCompletionCandidate } from './feedback'
import {
  shouldRequestInlineCompletion,
  shouldRequestLongInlineCompletion
} from './policy'
import type {
  InlineCompletionFeedback,
  InlineCompletionRequestContext,
  InlineCompletionSuggestion
} from './types'
import type { WriteInlineCompletionMode } from '@shared/write-inline-completion'

type InlineCompletionConfig = {
  debounceMs?: number
  getDebounceMs?: () => number
  getMinAcceptScore?: () => number
  getLongDebounceMs?: () => number
  getLongMinAcceptScore?: () => number
  isLongEnabled?: () => boolean
  isEnabled?: () => boolean
  getFilePath?: () => string
  language?: string
  getModel?: () => string
  requestCompletion: (
    context: InlineCompletionRequestContext,
    mode: WriteInlineCompletionMode
  ) => Promise<InlineCompletionSuggestion | null>
  onError?: (error: unknown) => void
  onFeedback?: (feedback: InlineCompletionFeedback) => void
}

const setInlineCompletionEffect = StateEffect.define<{
  text: string
  anchor: number
  feedback: InlineCompletionFeedback
}>()
const clearInlineCompletionEffect = StateEffect.define<null>()

const inlineCompletionState = StateField.define<{
  text: string
  anchor: number
  feedback: InlineCompletionFeedback
} | null>({
  create() {
    return null
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInlineCompletionEffect)) return effect.value
      if (effect.is(clearInlineCompletionEffect)) return null
    }
    return value
  }
})

class InlineCompletionWidget extends WidgetType {
  constructor(private readonly text: string) {
    super()
  }

  override eq(other: InlineCompletionWidget): boolean {
    return other.text === this.text
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-inline-completion'
    span.textContent = this.text
    return span
  }

  override get lineBreaks(): number {
    return this.text.split('\n').length - 1
  }
}

function clearInlineCompletion(view: EditorView): void {
  const current = view.state.field(inlineCompletionState)
  if (!current) return
  view.dispatch({ effects: clearInlineCompletionEffect.of(null) })
}

function feedbackFromInteraction(
  decision: 'accept' | 'dismiss',
  completion: { feedback: InlineCompletionFeedback } | null
): InlineCompletionFeedback {
  return {
    phase: 'interaction',
    decision,
    reason: decision === 'accept' ? 'tab-applied' : 'escape-dismissed',
    score: completion?.feedback.score || 0,
    preview: completion?.feedback.preview || '',
    mode: completion?.feedback.mode
  }
}

function buildRequestContext(state: EditorState, config: InlineCompletionConfig): InlineCompletionRequestContext {
  return buildInlineCompletionRequestContext(state, {
    filePath: config.getFilePath?.() || '',
    language: config.language || 'markdown'
  })
}

const inlineCompletionRenderPlugin = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none

    constructor(view: EditorView) {
      this.update({ state: view.state } as never)
    }

    update(update: { state: EditorState }): void {
      const completion = update.state.field(inlineCompletionState)
      if (
        !completion?.text ||
        completion.anchor !== update.state.selection.main.head ||
        !update.state.selection.main.empty
      ) {
        this.decorations = Decoration.none
        return
      }

      const widget = Decoration.widget({
        widget: new InlineCompletionWidget(completion.text),
        side: 1
      })
      this.decorations = Decoration.set([widget.range(update.state.selection.main.head)], true)
    }
  },
  {
    decorations: (value) => value.decorations
  }
)

const inlineCompletionController = (config: InlineCompletionConfig) =>
  ViewPlugin.fromClass(class {
    private sequence = 0
    private shortTimer: number | null = null
    private longTimer: number | null = null

    constructor(private readonly view: EditorView) {
      this.schedule(view.state)
    }

    update(update: { docChanged: boolean; selectionSet: boolean; focusChanged: boolean; state: EditorState }): void {
      if (!update.docChanged && !update.selectionSet && !update.focusChanged) return
      this.schedule(update.state)
    }

    private schedule(state: EditorState): void {
      this.sequence += 1
      this.clearTimers()

      const requestContext = buildRequestContext(state, config)
      const shouldRequestShort = shouldRequestInlineCompletion(requestContext, config.isEnabled)
      const shouldRequestLong = shouldRequestLongInlineCompletion(
        requestContext,
        config.isEnabled,
        config.isLongEnabled
      )
      if (!shouldRequestShort && !shouldRequestLong) {
        clearInlineCompletion(this.view)
        return
      }

      const requestId = this.sequence
      if (shouldRequestShort) {
        this.shortTimer = window.setTimeout(() => {
          this.shortTimer = null
          void this.requestAndRender('short', requestId)
        }, config.getDebounceMs?.() ?? config.debounceMs ?? INLINE_COMPLETION_DEBOUNCE_MS)
      }
      if (shouldRequestLong) {
        this.longTimer = window.setTimeout(() => {
          this.longTimer = null
          void this.requestAndRender('long', requestId)
        }, config.getLongDebounceMs?.() ?? INLINE_LONG_COMPLETION_DEBOUNCE_MS)
      }
    }

    private async requestAndRender(mode: WriteInlineCompletionMode, requestId: number): Promise<void> {
      const latestState = this.view.state
      const latestContext = buildRequestContext(latestState, config)
      const shouldRequest = mode === 'long'
        ? shouldRequestLongInlineCompletion(latestContext, config.isEnabled, config.isLongEnabled)
        : shouldRequestInlineCompletion(latestContext, config.isEnabled)
      if (!shouldRequest) {
        clearInlineCompletion(this.view)
        return
      }

      const suggestion = await config.requestCompletion(latestContext, mode).catch((error: unknown) => {
        config.onError?.(error)
        return null
      })

      if (requestId !== this.sequence) return
      if (this.view.state !== latestState) return

      const decision = evaluateInlineCompletionCandidate(latestContext, suggestion, {
        minAcceptScore: mode === 'long'
          ? config.getLongMinAcceptScore?.()
          : config.getMinAcceptScore?.(),
        mode
      })
      config.onFeedback?.(decision.feedback)
      if (!decision.accepted) {
        clearInlineCompletion(this.view)
        return
      }

      this.view.dispatch({
        effects: setInlineCompletionEffect.of({
          text: decision.text,
          anchor: latestContext.head,
          feedback: decision.feedback
        })
      })
    }

    private clearTimers(): void {
      if (this.shortTimer) window.clearTimeout(this.shortTimer)
      if (this.longTimer) window.clearTimeout(this.longTimer)
      this.shortTimer = null
      this.longTimer = null
    }

    destroy(): void {
      this.sequence += 1
      this.clearTimers()
    }
  })

function acceptInlineCompletionFactory(config: InlineCompletionConfig) {
  return (view: EditorView): boolean => {
    const completion = view.state.field(inlineCompletionState)
    if (!completion?.text || completion.anchor !== view.state.selection.main.head) return false

    const head = view.state.selection.main.head
    const nextHead = head + completion.text.length
    view.dispatch({
      changes: { from: head, insert: completion.text },
      selection: { anchor: nextHead },
      effects: clearInlineCompletionEffect.of(null)
    })
    config.onFeedback?.(feedbackFromInteraction('accept', completion))
    return true
  }
}

function rejectInlineCompletionFactory(config: InlineCompletionConfig) {
  return (view: EditorView): boolean => {
    const completion = view.state.field(inlineCompletionState)
    if (!completion || completion.anchor !== view.state.selection.main.head) return false
    view.dispatch({ effects: clearInlineCompletionEffect.of(null) })
    config.onFeedback?.(feedbackFromInteraction('dismiss', completion))
    return true
  }
}

export function buildInlineCompletionExtension(config: InlineCompletionConfig): Extension {
  return [
    inlineCompletionState,
    inlineCompletionRenderPlugin,
    inlineCompletionController(config),
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: acceptInlineCompletionFactory(config) },
        { key: 'Escape', run: rejectInlineCompletionFactory(config) }
      ])
    )
  ]
}
