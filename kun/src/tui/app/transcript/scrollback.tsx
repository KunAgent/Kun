import { BoxRenderable, type CliRenderer } from '@opentui/core'
import { RendererContext, _render } from '@opentui/solid'
import { Show, type JSX } from 'solid-js'
import { cellWidth } from '../../layout.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import type { ScrollbackCommit } from '../../scrollback-plan.js'
import type { ScrollbackRenderOptions } from '../../session/session-types.js'
import { AppContext, type AppContextValue } from '../context.js'
import { Line, seg } from '../ui.js'
import { TranscriptEntryView, type EntryRenderOptions } from './entry-view.js'

const SETTLE_TIMEOUT_MS = 2_000

function ThreadHeader(props: { title: string; omitted: number; width: number }): JSX.Element {
  const title = () => sanitizeTerminalText(props.title)
  // " KUN / " plus a space before the rule; the rule fills the rest.
  const rule = () => '─'.repeat(Math.max(0, props.width - cellWidth(title()) - 9))
  return (
    <box flexDirection="column" flexShrink={0} marginTop={1}>
      <Line
        segments={[' ', seg.brand('KUN', { bold: true }), seg.muted(' / '), seg.bold(title()), ' ', seg.muted(rule())]}
        maxWidth={props.width}
      />
      <Show when={props.omitted > 0}>
        <Line segments={[seg.muted(` … ${props.omitted} earlier turn${props.omitted === 1 ? '' : 's'} not replayed · Ctrl+O or /timeline browses them`)]} />
      </Show>
    </box>
  )
}

/**
 * Writes committed transcript entries into the terminal's native scrollback,
 * strictly in order. Each entry is laid out on a scrollback surface with the
 * same components as the live window, and the surface settles first so
 * asynchronously rendered Markdown is complete before its rows are printed.
 */
export class ScrollbackWriter {
  private chain: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(
    private readonly renderer: CliRenderer,
    private readonly app: AppContextValue,
    private readonly onError: (error: unknown) => void
  ) {}

  get busy(): boolean {
    return this.pending > 0
  }

  write(commits: readonly ScrollbackCommit[], options: ScrollbackRenderOptions): void {
    const entryOptions: EntryRenderOptions = {
      details: options.showToolDetails,
      showReasoning: options.showReasoning,
      frame: 0,
      legacyGui: options.legacyGui,
      attachments: this.app.controller.state.attachmentMetadata,
      live: false,
      clickable: false,
      reasoningExpanded: (_itemId, fallback) => fallback
    }
    for (const commit of commits) {
      this.pending += 1
      this.chain = this.chain
        .then(() => this.writeOne(commit, entryOptions))
        .catch((error: unknown) => this.onError(error))
        .finally(() => { this.pending -= 1 })
    }
  }

  /** Resolves once every queued commit has been printed. */
  drain(): Promise<void> {
    return this.chain
  }

  private async writeOne(commit: ScrollbackCommit, options: EntryRenderOptions): Promise<void> {
    if (this.renderer.isDestroyed) return
    const surface = this.renderer.createScrollbackSurface({ startOnNewLine: true })
    const width = surface.width
    const root = new BoxRenderable(surface.renderContext, { width, height: 'auto', flexDirection: 'column' })
    surface.root.add(root)
    const app: AppContextValue = { ...this.app, width: () => width }
    const dispose = _render(() => (
      <RendererContext.Provider value={surface.renderContext as never}>
        <AppContext.Provider value={app}>
          {commit.kind === 'thread-header'
            ? <ThreadHeader title={commit.title} omitted={commit.omitted} width={width} />
            : <TranscriptEntryView entry={commit.entry} options={options} first={commit.first} />}
        </AppContext.Provider>
      </RendererContext.Provider>
    ) as unknown as BoxRenderable, root)
    try {
      surface.render()
      await surface.settle(SETTLE_TIMEOUT_MS)
      surface.render()
      const rows = Math.max(0, Math.ceil(root.height))
      if (rows > 0 && !surface.isDestroyed && !this.renderer.isDestroyed) surface.commitRows(0, rows)
    } finally {
      dispose()
      if (!surface.isDestroyed) surface.destroy()
      this.renderer.requestRender()
    }
  }
}
