import { createMemo, For, Index, Show, type JSX } from 'solid-js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { relativeTime } from '../../session-view-model.js'
import { AppContext, useApp } from '../context.js'
import { Composer, type ComposerHandlers } from '../chat/composer.js'
import { PromptFooter } from '../chat/status-rows.js'
import type { KunTheme } from '../theme.js'
import { Line, seg, SplitRow, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'
import { sharedWithGui, workspaceLabel } from '../session/sidebar.js'

/**
 * Pixel "kun". `_` is a shadow cell (space on the shadow color) and `~` a
 * shadow-colored half block, which gives the letters their depth.
 */
const LOGO = ['▄             ', '█ ▄▀ █  █ █▀▀▄', '█▀▄  █__█ █__█', '▀  ▀ ▀▀▀▀ ▀~~▀']
const PROMPT_MAX_WIDTH = 75
const RECENT = 3
/** Below this height the recent sessions give way to the prompt. */
const RECENT_MIN_ROWS = 26

function logoSegments(line: string, theme: KunTheme): SegInput[] {
  return Array.from(line).map((char): SegInput => {
    if (char === '_') return { text: ' ', bg: theme.logoShadow }
    if (char === '~') return { text: '▀', color: theme.logoShadow }
    return { text: char, color: theme.brand, bold: true }
  })
}

/** Start screen: logo, the name's origin, the prompt, recent sessions. */
export function HomeView(props: ComposerHandlers): JSX.Element {
  const app = useApp()
  const width = () => Math.max(20, Math.min(app.width() - 4, PROMPT_MAX_WIDTH))
  const recent = createMemo(() => {
    app.tick()
    return app.session.state.threads.slice(0, RECENT)
  })
  const version = () => sanitizeTerminalText(app.controller.runtime.runtimeInfo.serviceVersion)
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexGrow={1} minHeight={0} flexDirection="column" alignItems="center">
        <box flexGrow={1} minHeight={0} />
        <Index each={LOGO}>{(line) => <Txt content={styled(app.theme(), logoSegments(line(), app.theme()))} wrapMode="none" flexShrink={0} />}</Index>
        <box height={1} flexShrink={0} />
        <Line segments={[seg.faint('北冥有鱼，其名为鲲')]} />
        <box height={2} flexShrink={0} />
        <box width={width()} flexShrink={0} flexDirection="column">
          <AppContext.Provider value={{ ...app, width }}>
            <Composer onTextarea={props.onTextarea} onSubmit={props.onSubmit} onChange={props.onChange} />
            <PromptFooter home />
            <Show when={recent().length > 0 && app.renderer.terminalHeight >= RECENT_MIN_ROWS}>
              <box height={2} flexShrink={0} />
              <SplitRow
                left={[seg.faint('  Recent')]}
                right={[seg.faint(`${app.session.keymap.display('session_list').toLowerCase()} all ${app.session.state.threads.length}  `)]}
              />
              <For each={recent()}>
                {(thread, index) => (
                  <box flexShrink={0} onMouseDown={() => app.session.handleLiveClick({ kind: 'session', threadId: thread.id })}>
                    <SplitRow
                      left={[seg.brand(`  ${index() + 1}  `), sanitizeTerminalText(thread.title || 'Untitled')]}
                      right={[
                        ...(thread.status === 'running' ? [seg.brand('running'), seg.faint(' · ')] : []),
                        seg.faint(`${relativeTime(thread.updatedAt)}  `)
                      ]}
                    />
                  </box>
                )}
              </For>
            </Show>
          </AppContext.Provider>
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
      <box flexShrink={0} paddingLeft={2} paddingRight={2}>
        <AppContext.Provider value={{ ...app, width: () => Math.max(10, app.width() - 4) }}>
          <SplitRow
            left={[...workspaceLabel(app), ...(sharedWithGui(app) ? [seg.brand('   ⧉'), seg.muted(' shared with GUI')] : [])]}
            right={[seg.brand('◆'), seg.faint(` Kun ${version()}`)]}
          />
        </AppContext.Provider>
      </box>
    </box>
  )
}
