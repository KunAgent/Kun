import type { MouseEvent, Renderable } from '@opentui/core'
import { createMemo, Show, type JSX } from 'solid-js'
import { stripSgr } from '../../ansi-text.js'
import { wrapText } from '../../layout.js'
import type { PageSize, PageView, TuiPage } from '../../page-model.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { AppContext, useApp } from '../context.js'
import { PANEL_BAR, PanelEdge } from '../chat/composer.js'
import { seg, SplitRow, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'
import { Body, Footer, StatusLine } from './page-blocks.js'

const DIALOG_MAX_WIDTH = 96
const DIALOG_MIN_WIDTH = 42
/** Pages that answer the running turn sit where the prompt is. */
const DOCKED_PAGE_KINDS = new Set(['approval', 'input'])

export function isDockedPage(page: TuiPage | undefined): boolean {
  return Boolean(page && DOCKED_PAGE_KINDS.has(page.kind))
}

/** Body rows, or undefined when a block fills whatever height it is given. */
function estimateBodyRows(view: PageView, width: number): number | undefined {
  let rows = 0
  for (const block of view.body) {
    if (block.kind === 'transcript') return undefined
    rows += block.kind === 'text' ? wrapText(stripSgr(block.text), Math.max(1, width - 1)).length : 1
  }
  return rows
}

function chromeRows(view: PageView, width: number): number {
  const description = view.description ? wrapText(view.description, Math.max(1, width)).length + 1 : 0
  // Top and bottom padding, the title row, the spacer above the footer, the footer.
  return 1 + 1 + description + (view.status ? 1 : 0) + 1 + 1 + 1
}

function pageTitle(view: PageView): string {
  const path = view.path.filter(Boolean)
  const parts = path[0] === 'KUN' && path.length > 1 ? path.slice(1) : path
  return sanitizeTerminalText(view.popupTitle ?? parts.join(' / '))
}

type Geometry = { view: PageView; width: number; height: number; top: number; inner: number }

/**
 * A page as a dialog over the dimmed session: on the raised surface a
 * quarter of the way down, sized to its content, closed by esc or a click
 * outside. Popup pages (a subagent's session, the Graph board) are larger
 * and centered.
 */
export function PageDialog(props: { page: TuiPage }): JSX.Element {
  const app = useApp()
  const geometry = createMemo((): Geometry => {
    app.tick()
    const columns = app.renderer.terminalWidth
    const rows = app.renderer.terminalHeight
    const width = Math.max(Math.min(DIALOG_MIN_WIDTH, columns), Math.min(DIALOG_MAX_WIDTH, columns - 4))
    const top = Math.max(1, Math.floor(rows / 4))
    const size = (outer: number, height: number): PageSize => ({ width: Math.max(1, outer - 4), height })
    let view = props.page.view(size(width, Math.max(6, rows - top - 3)))
    if (view.frame === 'popup') {
      const popupWidth = Math.max(Math.min(DIALOG_MIN_WIDTH, columns), Math.floor(columns * 0.9))
      const popupHeight = Math.max(8, Math.floor(rows * 0.85))
      view = props.page.view(size(popupWidth, popupHeight - 4))
      return { view, width: popupWidth, height: popupHeight, top: Math.max(0, Math.floor((rows - popupHeight) / 2)), inner: popupWidth - 4 }
    }
    const inner = width - 4
    const body = estimateBodyRows(view, inner)
    const max = Math.max(6, rows - top - 1)
    const height = body === undefined ? max : Math.min(max, body + chromeRows(view, inner))
    return { view, width, height, top, inner }
  })
  let backdrop: Renderable | undefined
  const dismiss = (event: MouseEvent): void => {
    if (event.target !== backdrop || app.renderer.getSelection()?.getSelectedText()) return
    app.session.dismissPage()
  }
  const view = () => geometry().view
  return (
    <box
      ref={(element: Renderable) => { backdrop = element }}
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={100}
      flexDirection="column"
      alignItems="center"
      paddingTop={geometry().top}
      backgroundColor={app.theme().scrim}
      onMouseUp={dismiss}
    >
      <box
        width={geometry().width}
        height={geometry().height}
        flexShrink={0}
        backgroundColor={app.theme().raised}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <AppContext.Provider value={{ ...app, width: () => geometry().inner }}>
          <SplitRow
            left={[seg.bold(pageTitle(view()))]}
            right={[view().right ? seg.muted(sanitizeTerminalText(view().right!)) : seg.faint('esc')]}
          />
          <Show when={view().description}>
            <Txt content={styled(app.theme(), [seg.muted(sanitizeTerminalText(view().description!))])} wrapMode="word" flexShrink={0} />
            <box height={1} flexShrink={0} />
          </Show>
          <Body view={view()} page={props.page} />
          <Show when={view().status}>
            <StatusLine status={view().status!} />
          </Show>
          <box height={1} flexShrink={0} />
          <Footer actions={view().footer} />
        </AppContext.Provider>
      </box>
    </box>
  )
}

/**
 * Permission requests and questions, in the prompt's place: a panel with a
 * bar in the status color (orange for permission, violet for a question)
 * and the page's keys on a darker band at its foot.
 */
export function PageDock(props: { page: TuiPage }): JSX.Element {
  const app = useApp()
  const approval = () => props.page.kind === 'approval'
  const bar = () => (approval() ? app.theme().warning : app.theme().accent)
  const inner = () => Math.max(10, app.width() - 5)
  const max = () => Math.max(8, Math.floor(app.renderer.terminalHeight * 0.55))
  const view = createMemo(() => {
    app.tick()
    // Pages reserve rows for full-page chrome; the dock's chrome is smaller.
    return props.page.view({ width: inner(), height: max() + 5 })
  })
  const header = (): SegInput[] => approval()
    ? [seg.warning('△'), seg.bold(' Permission required')]
    : [seg.accent('?'), seg.bold(` ${pageTitle(view())}`)]
  return (
    <box flexDirection="column" flexShrink={0}>
      <box border={['left']} borderColor={bar()} customBorderChars={PANEL_BAR} flexShrink={0}>
        <box flexDirection="column" flexGrow={1} backgroundColor={app.theme().panel} paddingLeft={2} paddingRight={2} paddingTop={1} maxHeight={max()}>
          <AppContext.Provider value={{ ...app, width: inner }}>
            <SplitRow left={header()} right={view().right ? [seg.muted(sanitizeTerminalText(view().right!))] : []} />
            <Show when={view().description}>
              <Txt content={styled(app.theme(), [seg.muted(sanitizeTerminalText(view().description!))])} wrapMode="word" flexShrink={0} />
            </Show>
            <box height={1} flexShrink={0} />
            <Body view={view()} page={props.page} />
          </AppContext.Provider>
        </box>
      </box>
      <box border={['left']} borderColor={bar()} customBorderChars={PANEL_BAR} flexShrink={0}>
        <box flexGrow={1} backgroundColor={app.theme().band} paddingLeft={2} paddingRight={2}>
          <AppContext.Provider value={{ ...app, width: inner }}>
            <Footer actions={view().footer} />
          </AppContext.Provider>
        </box>
      </box>
      <PanelEdge bar={bar()} fill={app.theme().band} />
    </box>
  )
}
