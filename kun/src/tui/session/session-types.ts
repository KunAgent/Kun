import type { AutocompleteItem } from '../autocomplete.js'
import type { ClipboardImage } from '../clipboard-image.js'
import type { TuiKeyAction } from '../keymap.js'
import type { TuiPage } from '../page-model.js'
import type { OfficialProviderCliId } from '../../services/official-provider-cli.js'

/** The multi-line prompt editor owned by the terminal app (an opentui textarea). */
export interface ComposerPort {
  getText(): string
  /** Replace the draft; the cursor moves to `cursor` (character offset) or the end. */
  setText(text: string, cursor?: number): void
  insertText(text: string): void
  insertNewline(): void
  /** Logical cursor position (0-based line and character column). */
  cursor(): { line: number; col: number }
}

/** Terminal capabilities the session needs from the renderer. */
export interface TerminalPort {
  setTitle(title: string): void
  /** OSC 52 clipboard request; false when the renderer could not queue it. */
  copyToClipboard(text: string): boolean
  setMouseEnabled(enabled: boolean): void
  /**
   * Hand the terminal to a foreground program (editor, shell, provider CLI)
   * and restore the renderer afterwards, even when `work` throws.
   */
  suspend<T>(work: () => Promise<T>): Promise<T>
  /** Repaint everything the renderer owns (Ctrl+L, /clear). */
  repaint(): void
  size(): { width: number; height: number }
  /** Send SIGTSTP to the process group after restoring the terminal. */
  suspendProcess(): void
}

export type ViewportScroll =
  | 'page-up' | 'page-down' | 'line-up' | 'line-down' | 'half-page-up' | 'half-page-down' | 'first' | 'last'

/** The scrollable conversation the app renders; scroll position lives there. */
export interface ViewportPort {
  scroll(target: ViewportScroll): void
}

export type AutocompleteView = {
  items: readonly AutocompleteItem[]
  selected: number
  prefix: string
}

export type PageEntry = {
  page: TuiPage
  /** Pages mirrored from controller state are removed when that state clears. */
  source: 'user' | 'sync'
}

export type LeaderHint = Array<{ action: TuiKeyAction; key: string }>

export type LiveClickTarget =
  | { kind: 'thinking'; itemId: string }
  | { kind: 'child'; childId: string }
  | { kind: 'graph' }

export type ChatSessionDependencies = {
  clipboardImageReader?: () => Promise<ClipboardImage | null>
  officialProviderAuthenticator?: (provider: OfficialProviderCliId) => Promise<void>
  editText?: (initial: string) => Promise<string>
}
