import type { TextareaRenderable } from '@opentui/core'
import { createMemo, For, Show, type JSX } from 'solid-js'
import { currentMode, currentModel, formatBytes } from '../../chat-format.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { useApp } from '../context.js'
import { Line, seg, SplitRow, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'

const MAX_AUTOCOMPLETE_ROWS = 8

export const COMPOSER_KEY_BINDINGS = [
  { name: 'return', action: 'submit' as const },
  { name: 'kpenter', action: 'submit' as const },
  { name: 'return', shift: true, action: 'newline' as const },
  { name: 'return', meta: true, action: 'newline' as const }
]

function Divider(): JSX.Element {
  const app = useApp()
  return (
    <box marginLeft={-1} marginRight={-1} flexShrink={0}>
      <Txt content={styled(app.theme(), [seg.brand(`├${'─'.repeat(Math.max(0, app.width() - 2))}┤`)])} wrapMode="none" truncate />
    </box>
  )
}

function AutocompleteList(): JSX.Element {
  const app = useApp()
  const view = createMemo(() => {
    app.tick()
    const autocomplete = app.session.autocomplete
    if (!autocomplete) return undefined
    const start = Math.max(0, Math.min(
      autocomplete.selected - Math.floor(MAX_AUTOCOMPLETE_ROWS / 2),
      autocomplete.items.length - MAX_AUTOCOMPLETE_ROWS
    ))
    return {
      rows: autocomplete.items.slice(start, start + MAX_AUTOCOMPLETE_ROWS).map((item, offset) => ({
        item,
        index: start + offset,
        selected: start + offset === autocomplete.selected
      })),
      more: autocomplete.items.length > MAX_AUTOCOMPLETE_ROWS ? `${autocomplete.selected + 1}/${autocomplete.items.length}` : ''
    }
  })
  return (
    <Show when={view()}>
      <Divider />
      <For each={view()!.rows}>
        {(row) => (
          <SplitRow
            onMouseDown={() => app.session.applyAutocomplete(row.index)}
            left={[
              row.selected ? seg.focus(' › ') : '   ',
              { text: sanitizeTerminalText(row.item.label), bold: row.selected, tone: row.selected ? 'normal' : 'normal' }
            ]}
            right={row.item.description ? [seg.muted(sanitizeTerminalText(row.item.description))] : []}
          />
        )}
      </For>
      <Show when={view()!.more}>
        <Line segments={[seg.muted(`   ${view()!.more} · ↑/↓ choose · Tab insert · Enter run`)]} />
      </Show>
    </Show>
  )
}

function AttachmentChips(): JSX.Element {
  const app = useApp()
  const attachments = createMemo(() => {
    app.tick()
    return app.session.state.pendingAttachments
  })
  return (
    <For each={attachments()}>
      {(attachment, index) => (
        <SplitRow
          left={[
            ' ',
            seg.focus(`Attachment ${index() + 1}/${attachments().length}`), ' ',
            seg.focus(`[${attachment.kind === 'image' ? 'Image' : 'File'}]`), ' ',
            sanitizeTerminalText(attachment.name), ' ',
            seg.muted(`· ${formatBytes(attachment.byteSize)}`)
          ]}
          right={index() === attachments().length - 1 ? [seg.muted(app.width() >= 72 ? 'Backspace/Del remove' : 'Del remove')] : []}
        />
      )}
    </For>
  )
}

function Metadata(): JSX.Element {
  const app = useApp()
  const segments = createMemo((): SegInput[] => {
    app.tick()
    const state = app.session.state
    const mode = currentMode(state)
    return [
      ' ',
      seg.muted(currentModel(state, app.controller)),
      seg.muted(' · '),
      seg.focus(state.reasoningEffort ?? 'default'),
      seg.muted(' · '),
      mode === 'goal'
        ? seg.success(mode, { bold: true })
        : mode === 'plan' ? seg.warning(mode, { bold: true }) : mode === 'graph' ? seg.accent(mode, { bold: true }) : seg.muted(mode)
    ]
  })
  return <Line segments={segments()} />
}

/**
 * Bordered composer: pending attachments, the prompt editor, the inline
 * autocomplete list and a single metadata row (model · effort · mode).
 */
export function Composer(props: {
  onTextarea: (textarea: TextareaRenderable) => void
  onSubmit: () => void
  onChange: () => void
}): JSX.Element {
  const app = useApp()
  return (
    <box border borderStyle="single" borderColor={app.theme().brand ?? '#888888'} flexDirection="column" flexShrink={0}>
      <AttachmentChips />
      <box flexDirection="row" flexShrink={0}>
        <box flexShrink={0} width={3}>
          <Txt content={styled(app.theme(), [' ', seg.user('›'), ' '])} wrapMode="none" />
        </box>
        <textarea
          ref={(element: TextareaRenderable) => props.onTextarea(element)}
          flexGrow={1}
          flexShrink={1}
          minHeight={1}
          maxHeight={6}
          wrapMode="word"
          placeholder="Type a task · / commands · @ files"
          keyBindings={COMPOSER_KEY_BINDINGS}
          onSubmit={() => props.onSubmit()}
          onContentChange={() => props.onChange()}
          onCursorChange={() => props.onChange()}
        />
      </box>
      <AutocompleteList />
      <Divider />
      <Metadata />
    </box>
  )
}
