import { createMemo, For, Show, type JSX } from 'solid-js'
import { imagePasteShortcutLabel } from '../../chat-format.js'
import { AppContext, useApp } from '../context.js'
import { Composer, type ComposerHandlers } from '../chat/composer.js'
import { ActivityRow, StatusFooter } from '../chat/status-rows.js'
import { Line, seg, type SegInput } from '../ui.js'

const LOGO = ['█▄▀ █ █ █▄ █', '█ █ █▄█ █ ▀█']
const PROMPT_MAX_WIDTH = 76
/** Below this height the command hints give way to the prompt. */
const HINT_MIN_ROWS = 22

/** Start screen before a session is open: logo, prompt and first commands. */
export function HomeView(props: ComposerHandlers): JSX.Element {
  const app = useApp()
  const width = () => Math.max(20, Math.min(app.width() - 4, PROMPT_MAX_WIDTH))
  const threads = createMemo(() => {
    app.tick()
    return app.session.state.threads.length
  })
  const command = (key: string, label: string): SegInput[] => [' ', seg.focus('›'), ' ', seg.bold(key), ' ', seg.muted(label)]
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexGrow={1} minHeight={0} flexDirection="column" alignItems="center">
        <box flexGrow={1} minHeight={0} />
        <For each={LOGO}>{(line) => <Line segments={[seg.brand(line, { bold: true })]} />}</For>
        <box height={1} flexShrink={0} />
        <Line segments={[seg.muted('A focused terminal agent that keeps working with you.')]} />
        <box height={1} flexShrink={0} />
        <box width={width()} flexShrink={0} flexDirection="column">
          <AppContext.Provider value={{ ...app, width }}>
            <Composer onTextarea={props.onTextarea} onSubmit={props.onSubmit} onChange={props.onChange} />
            <ActivityRow />
            <Show when={app.renderer.terminalHeight >= HINT_MIN_ROWS}>
              <box height={1} flexShrink={0} />
              <Line segments={command('/connect', 'add or manage a provider')} maxWidth={width()} />
              <Line segments={command('/sessions', threads() ? `resume previous work · ${threads()} saved` : 'resume previous work')} maxWidth={width()} />
              <Line segments={command('/graph <requirement>', 'start or steer a Graph run')} maxWidth={width()} />
              <Line segments={command(imagePasteShortcutLabel(), 'paste a screenshot · /paste also works')} maxWidth={width()} />
              <Line segments={command(app.session.keymap.display('command_list'), 'all commands')} maxWidth={width()} />
            </Show>
          </AppContext.Provider>
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
      <StatusFooter home />
    </box>
  )
}
