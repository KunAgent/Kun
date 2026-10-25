import type { TextareaRenderable } from '@opentui/core'
import { createMemo, For, Show, type JSX } from 'solid-js'
import { currentMode, currentModel, formatBytes } from '../../chat-format.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { AppContext, useApp } from '../context.js'
import { ringSegments, sessionContextUsage } from '../session/sidebar.js'
import { Line, seg, SplitRow, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'

const MAX_AUTOCOMPLETE_ROWS = 8

export const COMPOSER_KEY_BINDINGS = [
  { name: 'return', action: 'submit' as const },
  { name: 'kpenter', action: 'submit' as const },
  { name: 'return', shift: true, action: 'newline' as const },
  { name: 'return', meta: true, action: 'newline' as const }
]

/** Left edge of a panel: a heavy bar in the mode or status color. */
export const PANEL_BAR = {
  topLeft: '', topRight: '', bottomLeft: '', bottomRight: '', horizontal: ' ', vertical: '┃',
  topT: '', bottomT: '', leftT: '', rightT: '', cross: ''
}

export type ComposerHandlers = {
  onTextarea: (textarea: TextareaRenderable) => void
  onSubmit: () => void
  onChange: () => void
}

/** Half-row bottom edge of a panel: the bar ends in ╹ and the fill in ▀. */
export function PanelEdge(props: { bar: import('@opentui/core').RGBA; fill: import('@opentui/core').RGBA }): JSX.Element {
  const app = useApp()
  return <Line segments={[seg.color('╹', props.bar), seg.color('▀'.repeat(Math.max(0, app.width() - 1)), props.fill)]} />
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
      <box height={1} flexShrink={0} />
      <For each={view()!.rows}>
        {(row) => (
          <box flexShrink={0} {...(row.selected ? { backgroundColor: app.theme().sel } : {})}>
            <SplitRow
              onMouseDown={() => app.session.applyAutocomplete(row.index)}
              left={[' ', { text: sanitizeTerminalText(row.item.label), bold: row.selected }]}
              right={row.item.description ? [seg.muted(sanitizeTerminalText(row.item.description)), ' '] : []}
            />
          </box>
        )}
      </For>
      <Show when={view()!.more}>
        <Line segments={[seg.faint(` ${view()!.more} · ↑↓ choose · tab insert · enter run`)]} />
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
    <Show when={attachments().length > 0}>
      <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0} paddingBottom={1}>
        <For each={attachments()}>
          {(attachment) => (
            <Txt content={styled(app.theme(), [
              { text: attachment.kind === 'image' ? ' img ' : ' file ', color: app.theme().panel, bg: app.theme().brand, bold: true },
              { text: ` ${sanitizeTerminalText(attachment.name)} · ${formatBytes(attachment.byteSize)} `, tone: 'muted', bg: app.theme().high }
            ])} wrapMode="none" />
          )}
        </For>
        <Txt content={styled(app.theme(), [seg.faint('del removes the last')])} wrapMode="none" />
      </box>
    </Show>
  )
}

/** Mode · model provider · effort on the left; the context ring on the right. */
function Metadata(): JSX.Element {
  const app = useApp()
  const view = createMemo(() => {
    app.tick()
    const state = app.session.state
    const mode = currentMode(state)
    const model = currentModel(state, app.controller)
    const [provider, name] = model.includes(' / ') ? model.split(' / ', 2) as [string, string] : ['', model]
    return {
      mode,
      // The implicit "default" provider and effort say nothing; leave them out.
      provider: provider === 'default' ? '' : provider,
      name,
      effort: state.reasoningEffort,
      usage: sessionContextUsage(app)
    }
  })
  const left = (): SegInput[] => [
    seg.color(view().mode.charAt(0).toUpperCase() + view().mode.slice(1), app.theme().modes[view().mode], { bold: true }),
    '  ', view().name,
    view().provider ? seg.muted(` ${view().provider}`) : undefined,
    ...(view().effort ? [seg.muted(' · '), seg.warning(view().effort!)] : [])
  ]
  return <SplitRow left={left()} right={view().usage ? [...ringSegments(app.theme(), view().usage!)] : []} />
}

/**
 * The prompt: a filled panel with a bar in the current mode's color,
 * pending attachments, the editor, inline completions and the metadata row,
 * closed by a half-row edge.
 */
export function Composer(props: ComposerHandlers): JSX.Element {
  const app = useApp()
  const modeColor = createMemo(() => {
    app.tick()
    return app.theme().modes[currentMode(app.session.state)]
  })
  const inner = () => Math.max(10, app.width() - 5)
  return (
    <box flexDirection="column" flexShrink={0}>
      <box border={['left']} borderColor={modeColor()} customBorderChars={PANEL_BAR} flexShrink={0}>
        <box flexDirection="column" flexGrow={1} backgroundColor={app.theme().panel} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <AppContext.Provider value={{ ...app, width: inner }}>
          <AttachmentChips />
          <textarea
            ref={(element: TextareaRenderable) => props.onTextarea(element)}
            flexGrow={1}
            flexShrink={1}
            minHeight={1}
            maxHeight={8}
            wrapMode="word"
            placeholder="Ask anything…  / commands · @ files"
            backgroundColor={app.theme().panel}
            focusedBackgroundColor={app.theme().panel}
            textColor={app.theme().text}
            focusedTextColor={app.theme().text}
            placeholderColor={app.theme().faint}
            keyBindings={COMPOSER_KEY_BINDINGS}
            onSubmit={() => props.onSubmit()}
            onContentChange={() => props.onChange()}
            onCursorChange={() => props.onChange()}
          />
          <AutocompleteList />
          <box height={1} flexShrink={0} />
          <Metadata />
          </AppContext.Provider>
        </box>
      </box>
      <PanelEdge bar={modeColor()} fill={app.theme().panel} />
    </box>
  )
}
