import { RGBA, type MouseEvent, type Renderable } from '@opentui/core'
import { createMemo, Show, type JSX } from 'solid-js'
import { stripSgr } from '../../ansi-text.js'
import { wrapText } from '../../layout.js'
import type { PageSize, PageView, TuiPage } from '../../page-model.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { AppContext, useApp } from '../context.js'
import { seg, SplitRow, styled } from '../ui.js'
import { Txt } from '../txt.js'
import { Body, Footer, StatusLine } from './page-blocks.js'

const DIALOG_MAX_WIDTH = 100
const DIALOG_MIN_WIDTH = 42
/** Pages that answer the running turn sit where the composer is. */
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
  // Border (2) + title row + spacer above the footer + footer.
  return 2 + 1 + description + (view.status ? 1 : 0) + 2
}

function pageTitle(view: PageView): string {
  const path = view.path.filter(Boolean)
  const parts = path[0] === 'KUN' && path.length > 1 ? path.slice(1) : path
  return sanitizeTerminalText(view.popupTitle ?? parts.join(' / '))
}

type Geometry = { view: PageView; width: number; height: number; inner: number }

function PanelContent(props: { geometry: Geometry; page: TuiPage; hint: string }): JSX.Element {
  const app = useApp()
  const view = () => props.geometry.view
  return (
    <AppContext.Provider value={{ ...app, width: () => props.geometry.inner }}>
      <SplitRow
        width={props.geometry.inner}
        left={[seg.bold(pageTitle(view()))]}
        right={[seg.muted(view().right ? sanitizeTerminalText(view().right!) : props.hint)]}
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
  )
}

/**
 * A page shown as a dialog floating over the session: centered, sized to its
 * content, closed by Esc or a click outside it.
 */
export function PageDialog(props: { page: TuiPage }): JSX.Element {
  const app = useApp()
  const geometry = createMemo((): Geometry => {
    app.tick()
    const columns = app.renderer.terminalWidth
    const rows = app.renderer.terminalHeight
    const width = Math.max(Math.min(DIALOG_MIN_WIDTH, columns), Math.min(DIALOG_MAX_WIDTH, columns - 4))
    const size = (outer: number, height: number): PageSize => ({ width: Math.max(1, outer - 4), height })
    let view = props.page.view(size(width, Math.max(6, rows - 4)))
    if (view.frame === 'popup') {
      const popupWidth = Math.max(Math.min(DIALOG_MIN_WIDTH, columns), Math.floor(columns * 0.9))
      const popupHeight = Math.max(8, Math.floor(rows * 0.85))
      view = props.page.view(size(popupWidth, popupHeight - 2))
      return { view, width: popupWidth, height: popupHeight, inner: popupWidth - 4 }
    }
    const inner = width - 4
    const body = estimateBodyRows(view, inner)
    const max = Math.max(6, rows - 2)
    const height = body === undefined ? max : Math.min(max, body + chromeRows(view, inner))
    return { view, width, height, inner }
  })
  let backdrop: Renderable | undefined
  const dismiss = (event: MouseEvent): void => {
    if (event.target !== backdrop || app.renderer.getSelection()?.getSelectedText()) return
    app.session.dismissPage()
  }
  return (
    <box
      ref={(element: Renderable) => { backdrop = element }}
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={100}
      alignItems="center"
      justifyContent="center"
      onMouseUp={dismiss}
    >
      <box
        width={geometry().width}
        height={geometry().height}
        border
        borderStyle="rounded"
        borderColor={app.theme().brand ?? '#888888'}
        backgroundColor={RGBA.defaultBackground()}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
      >
        <PanelContent geometry={geometry()} page={props.page} hint="esc" />
      </box>
    </box>
  )
}

/** Approval and question pages, docked in place of the composer. */
export function PageDock(props: { page: TuiPage }): JSX.Element {
  const app = useApp()
  const geometry = createMemo((): Geometry => {
    app.tick()
    const width = Math.max(10, app.width())
    const inner = width - 4
    const max = Math.max(8, Math.floor(app.renderer.terminalHeight * 0.6))
    // Pages reserve rows for full-page chrome; the dock's chrome is smaller.
    const view = props.page.view({ width: inner, height: max + 5 })
    const body = estimateBodyRows(view, inner)
    const height = body === undefined ? max : Math.min(max, body + chromeRows(view, inner))
    return { view, width, height, inner }
  })
  return (
    <box
      height={geometry().height}
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={(props.page.kind === 'approval' ? app.theme().warning : app.theme().accent) ?? '#888888'}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <PanelContent geometry={geometry()} page={props.page} hint="" />
    </box>
  )
}
