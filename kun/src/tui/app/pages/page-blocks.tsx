import { CliRenderEvents, TextAttributes, type MouseEvent, type ScrollBoxRenderable } from '@opentui/core'
import { createMemo, For, Index, Match, onCleanup, Show, Switch, type JSX } from 'solid-js'
import { buildTranscriptEntries } from '../../transcript-model.js'
import type { PageAction, PageBlock, PageTranscript, PageView, TuiPage } from '../../page-model.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { ansiToStyled } from '../ansi.js'
import { useApp } from '../context.js'
import { TranscriptList, type EntryRenderOptions } from '../transcript/entry-view.js'
import { Line, seg, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'

function scrollDelta(event: MouseEvent): number {
  const direction = event.scroll?.direction
  return direction === 'up' ? -3 : direction === 'down' ? 3 : 0
}

export function Breadcrumb(props: { view: PageView }): JSX.Element {
  const left = (): SegInput[] => props.view.path.filter(Boolean).flatMap((part, index) => [
    ...(index === 0 ? [' ', seg.brand(sanitizeTerminalText(part), { bold: true })] : [seg.muted(' / '), sanitizeTerminalText(part)])
  ])
  const app = useApp()
  return (
    <box flexDirection="row" width="100%" flexShrink={0}>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <Txt content={styled(app.theme(), left())} wrapMode="none" truncate />
      </box>
      <Show when={props.view.right && app.width() >= 60}>
        <box flexShrink={1} marginLeft={1} maxWidth={Math.floor(app.width() * 0.48)}>
          <Txt content={ansiToStyled(sanitizeTerminalText(props.view.right!), { attributes: TextAttributes.DIM })} wrapMode="none" truncate />
        </box>
      </Show>
    </box>
  )
}

export function Rule(): JSX.Element {
  const app = useApp()
  return <Line segments={[seg.muted('─'.repeat(Math.max(1, app.width())))]} />
}

export function Footer(props: { actions: readonly PageAction[] }): JSX.Element {
  const app = useApp()
  const segments = (): SegInput[] => props.actions.flatMap((action, index) => [
    index === 0 ? '' : '   ',
    { text: action.key.toLowerCase(), tone: action.tone === 'danger' ? 'danger' : action.tone === 'warning' ? 'warning' : 'normal' },
    seg.muted(` ${sanitizeTerminalText(action.label)}`)
  ])
  return <Line segments={segments()} maxWidth={app.width()} />
}

function SelectionRow(props: { block: Extract<PageBlock, { kind: 'row' }>; page: TuiPage }): JSX.Element {
  const app = useApp()
  const select = (): void => {
    if (props.block.index !== undefined) props.page.handleMouse?.({ type: 'row', index: props.block.index, activate: true })
  }
  return (
    <box
      flexDirection="row"
      width="100%"
      flexShrink={0}
      onMouseDown={select}
      {...(props.block.selected ? { backgroundColor: app.theme().sel } : {})}
    >
      <box flexShrink={0} width={2} />
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <Txt
          content={ansiToStyled(props.block.left, { attributes: props.block.selected ? TextAttributes.BOLD : 0 })}
          wrapMode="none"
          truncate
        />
      </box>
      <Show when={props.block.right}>
        <box flexShrink={1} marginLeft={2} marginRight={1} maxWidth={Math.max(8, Math.floor(app.width() * 0.5))}>
          <Txt content={ansiToStyled(props.block.right!, { attributes: TextAttributes.DIM })} wrapMode="none" truncate />
        </box>
      </Show>
    </box>
  )
}

function Section(props: { label: string; right?: string }): JSX.Element {
  const app = useApp()
  return (
    <box flexDirection="row" width="100%" flexShrink={0}>
      <Show when={props.label}>
        <box flexShrink={0}>
          <Txt content={styled(app.theme(), [seg.faint(sanitizeTerminalText(props.label))])} wrapMode="none" />
        </box>
      </Show>
      <box flexGrow={1} flexShrink={1} minWidth={0} />
      <Show when={props.right}>
        <box flexShrink={0}>
          <Txt content={styled(app.theme(), [seg.faint(`${sanitizeTerminalText(props.right!)} `)])} wrapMode="none" />
        </box>
      </Show>
    </box>
  )
}

function Field(props: { block: Extract<PageBlock, { kind: 'field' }> }): JSX.Element {
  const app = useApp()
  const content = createMemo((): SegInput[] => {
    app.tick()
    const field = props.block.field
    const value = field.getValue()
    const label: SegInput[] = props.block.label ? [' ', seg.muted(props.block.label), '  '] : [' ']
    if (!value) {
      return [
        ...label,
        props.block.focused ? { text: ' ', color: app.theme().bg, bg: app.theme().text } : undefined,
        seg.faint(props.block.placeholder ?? '')
      ]
    }
    const mask = (text: string) => (props.block.masked ? '•'.repeat(Math.min(48, Array.from(text).length)) : text)
    const { before, after } = field.parts()
    const [cursorChar = ' ', ...rest] = Array.from(after)
    return props.block.focused
      ? [...label, mask(before), { text: props.block.masked ? (after ? '•' : ' ') : cursorChar, color: app.theme().bg, bg: app.theme().text }, mask(rest.join(''))]
      : [...label, mask(value)]
  })
  return (
    <box flexDirection="row" flexShrink={0} width="100%" backgroundColor={props.block.focused ? app.theme().bg : app.theme().high}>
      <box flexShrink={0} width={1} />
      <Txt content={styled(app.theme(), content())} wrapMode="none" truncate flexGrow={1} />
    </box>
  )
}

/** Scrollable transcript inside a page; scroll position lives in the model. */
function TranscriptBlock(props: { transcript: PageTranscript }): JSX.Element {
  const app = useApp()
  let scrollbox: ScrollBoxRenderable | undefined
  let applied = -1
  const sync = (): void => {
    if (!scrollbox || scrollbox.isDestroyed) return
    const scroll = props.transcript.scroll
    const before = scroll.label()
    if (applied >= 0 && scrollbox.scrollTop !== applied) scroll.scrollTo(scrollbox.scrollTop)
    scroll.measure(scrollbox.content.height, scrollbox.viewport.height)
    if (scrollbox.scrollTop !== scroll.offset) {
      scrollbox.scrollTop = scroll.offset
      app.renderer.requestRender()
    }
    applied = scrollbox.scrollTop
    // The page status shows the scroll range, known only after layout.
    if (scroll.label() !== before) queueMicrotask(() => app.session.layoutChanged())
  }
  app.renderer.on(CliRenderEvents.FRAME, sync)
  onCleanup(() => app.renderer.off(CliRenderEvents.FRAME, sync))
  const entries = createMemo(() => {
    app.tick()
    return buildTranscriptEntries(props.transcript.projection, {
      showReasoning: props.transcript.showReasoning,
      reasoningOverrides: props.transcript.reasoningOverrides
    })
  })
  const options = createMemo((): EntryRenderOptions => ({
    details: props.transcript.showToolDetails,
    showReasoning: props.transcript.showReasoning,
    frame: (app.tick(), app.session.animationFrame),
    legacyGui: app.controller.runtime.legacyGui === true,
    attachments: app.session.state.attachmentMetadata,
    clickable: true,
    reasoningExpanded: (itemId, fallback) => props.transcript.reasoningOverrides.get(itemId) ?? fallback,
    onToggleReasoning: (itemId) => props.transcript.toggleReasoning(itemId)
  }))
  return (
    <Show
      when={!props.transcript.placeholder}
      fallback={<For each={props.transcript.placeholder}>{(line) => <Txt content={ansiToStyled(line)} wrapMode="word" />}</For>}
    >
      <scrollbox
        ref={(element: ScrollBoxRenderable) => { scrollbox = element }}
        flexGrow={1}
        minHeight={1}
        scrollY
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box flexDirection="column" flexShrink={0} width="100%" paddingRight={1}>
          <TranscriptList entries={entries} options={options} />
        </box>
      </scrollbox>
    </Show>
  )
}

type LineBlock = Extract<PageBlock, { kind: 'line' }>
type TextBlock = Extract<PageBlock, { kind: 'text' }>
type SectionBlock = Extract<PageBlock, { kind: 'section' }>
type RowBlock = Extract<PageBlock, { kind: 'row' }>
type FieldBlock = Extract<PageBlock, { kind: 'field' }>
type TranscriptPageBlock = Extract<PageBlock, { kind: 'transcript' }>

/** Renders one block; every prop is a getter so updates never remount it. */
function Block(props: { block: PageBlock; page: TuiPage }): JSX.Element {
  const clickLine = (): void => {
    const index = (props.block as LineBlock).index
    if (index !== undefined) props.page.handleMouse?.({ type: 'row', index, activate: true })
  }
  return (
    <Switch>
      <Match when={props.block.kind === 'line'}>
        <Txt content={ansiToStyled((props.block as LineBlock).text)} wrapMode="none" truncate flexShrink={0} onMouseDown={clickLine} />
      </Match>
      <Match when={props.block.kind === 'text'}>
        <Txt content={ansiToStyled((props.block as TextBlock).text)} wrapMode="word" flexShrink={0} />
      </Match>
      <Match when={props.block.kind === 'section'}>
        <Section label={(props.block as SectionBlock).label} right={(props.block as SectionBlock).right} />
      </Match>
      <Match when={props.block.kind === 'row'}>
        <SelectionRow block={props.block as RowBlock} page={props.page} />
      </Match>
      <Match when={props.block.kind === 'field'}>
        <Field block={props.block as FieldBlock} />
      </Match>
      <Match when={props.block.kind === 'spacer'}>
        <box height={1} flexShrink={0} />
      </Match>
      <Match when={props.block.kind === 'transcript'}>
        <TranscriptBlock transcript={(props.block as TranscriptPageBlock).transcript} />
      </Match>
    </Switch>
  )
}

export function Body(props: { view: PageView; page: TuiPage }): JSX.Element {
  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      overflow="hidden"
      onMouseScroll={(event: MouseEvent) => {
        const delta = scrollDelta(event)
        if (delta) props.page.handleMouse?.({ type: 'scroll', delta })
      }}
    >
      <Index each={props.view.body}>{(block) => <Block block={block()} page={props.page} />}</Index>
    </box>
  )
}

export function StatusLine(props: { status: NonNullable<PageView['status']> }): JSX.Element {
  return (
    <box flexDirection="row" width="100%" flexShrink={0}>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <Txt content={ansiToStyled(props.status.left)} wrapMode="none" truncate />
      </box>
      <Show when={props.status.right}>
        <box flexShrink={0} marginLeft={1}>
          <Txt content={ansiToStyled(props.status.right!)} wrapMode="none" />
        </box>
      </Show>
    </box>
  )
}
