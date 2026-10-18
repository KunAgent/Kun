import type { CliRenderer, SyntaxStyle } from '@opentui/core'
import { createContext, useContext, type Accessor } from 'solid-js'
import type { TuiController } from '../controller.js'
import type { ChatSession } from '../session/chat-session.js'
import type { KunTheme } from './theme.js'

export type AppContextValue = {
  session: ChatSession
  controller: TuiController
  renderer: CliRenderer
  /** Bumped on every session change; read it to subscribe a computation. */
  tick: Accessor<number>
  theme: Accessor<KunTheme>
  syntax: Accessor<SyntaxStyle>
  /** Terminal width in columns (also valid inside scrollback snapshots). */
  width: Accessor<number>
}

export const AppContext = createContext<AppContextValue>()

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('Kun TUI context is missing')
  return value
}
