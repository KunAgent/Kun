import { terminalInstance } from './terminal-instance-registry'
import type { TerminalSearchOptions, TerminalSearchResult } from './terminal-search'

const EMPTY: TerminalSearchResult = { index: -1, count: 0, limited: false, invalid: false }

export function searchTerminalPane(
  ptySessionId: string,
  query: string,
  options: TerminalSearchOptions,
  direction: 'next' | 'previous' | 'same'
): TerminalSearchResult {
  return terminalInstance(ptySessionId)?.search.search(query, options, direction) ?? EMPTY
}

export function clearTerminalPaneSearch(ptySessionId: string): void {
  terminalInstance(ptySessionId)?.search.clear()
}
