import type { SlashCommand } from '@earendil-works/pi-tui'
import type { TuiKeyAction } from './keymap.js'

export type TuiCommandDefinition = {
  id: string
  title: string
  category: 'Global' | 'Session' | 'Model' | 'Display' | 'Workspace'
  slash?: string
  keyAction?: TuiKeyAction
  argumentRequired?: boolean
  available: boolean
}

export type TuiCommand =
  | { kind: 'help' }
  | { kind: 'threads'; search?: string }
  | { kind: 'resume'; search?: string }
  | { kind: 'clear' }
  | { kind: 'new'; title?: string }
  | { kind: 'open'; threadId: string }
  | { kind: 'rename'; title: string }
  | { kind: 'archive' }
  | { kind: 'archives'; search?: string }
  | { kind: 'fork'; title?: string }
  | { kind: 'compact' }
  | { kind: 'connect' }
  | { kind: 'usage-report' }
  | { kind: 'quota' }
  | { kind: 'model' }
  | { kind: 'reasoning' }
  | { kind: 'mouse'; action?: string }
  | { kind: 'variants' }
  | { kind: 'status' }
  | { kind: 'copy' }
  | { kind: 'export'; path?: string }
  | { kind: 'details' }
  | { kind: 'permission' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'init'; instructions?: string }
  | { kind: 'import'; args?: string }
  | { kind: 'mcp'; action?: string }
  | { kind: 'timeline'; query?: string }
  | { kind: 'jump'; target?: string }
  | { kind: 'subagents'; action?: string }
  | { kind: 'tasks'; action?: string }
  | { kind: 'attach'; path?: string }
  | { kind: 'paste' }
  | { kind: 'memory'; action?: string }
  | { kind: 'shells'; action?: string }
  | { kind: 'extensions'; action?: string }
  | { kind: 'theme'; name?: string }
  | { kind: 'share' }
  | { kind: 'unshare' }
  | { kind: 'console' }
  | { kind: 'diff' }
  | { kind: 'terminal' }
  | { kind: 'plan'; action?: string }
  | { kind: 'graph'; action?: string; prompt?: string }
  | { kind: 'agent' }
  | { kind: 'goal'; action?: string }
  | { kind: 'skills'; query?: string }
  | { kind: 'skill'; name: string; prompt?: string }
  | { kind: 'editor'; initial?: string }
  | { kind: 'add-dir'; path: string }
  | { kind: 'btw'; question: string }
  | { kind: 'context' }
  | { kind: 'capabilities' }
  | { kind: 'queue'; action?: string }
  | { kind: 'update'; confirm: boolean }
  | { kind: 'quit' }
  | { kind: 'command-usage'; usage: string }
  | { kind: 'unknown'; name: string }

export const TUI_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'sessions', description: 'Search, resume, pin, or delete sessions', argumentHint: '[search]' },
  { name: 'resume', description: 'Resume the most recent session, or search sessions', argumentHint: '[search]' },
  { name: 'continue', description: 'Resume the most recent session, or search sessions', argumentHint: '[search]' },
  { name: 'threads', description: 'Compatibility alias for /sessions', argumentHint: '[search]' },
  { name: 'new', description: 'Create a terminal session', argumentHint: '[title]' },
  { name: 'clear', description: 'Clear the terminal viewport without deleting the session' },
  { name: 'open', description: 'Open a session by id', argumentHint: '<session-id>' },
  { name: 'rename', description: 'Rename the active session', argumentHint: '<title>' },
  { name: 'title', description: 'Alias for /rename', argumentHint: '<title>' },
  { name: 'archive', description: 'Archive the active session' },
  { name: 'archives', description: 'Browse and restore archived sessions', argumentHint: '[search]' },
  { name: 'fork', description: 'Fork the active session', argumentHint: '[title]' },
  { name: 'compact', description: 'Compact the active conversation' },
  { name: 'summarize', description: 'Alias for /compact' },
  { name: 'connect', description: 'Configure a shared model connection' },
  { name: 'provider', description: 'Alias for /connect' },
  { name: 'usage', description: 'Show current and accumulated Kun model usage' },
  { name: 'quota', description: 'Show provider account balances and rate limits' },
  { name: 'model', description: 'Select the shared provider and model' },
  { name: 'models', description: 'Alias for /model' },
  { name: 'variants', description: 'Choose the model reasoning effort' },
  { name: 'thinking', description: 'Expand or collapse accumulated reasoning text' },
  { name: 'reasoning', description: 'Compatibility alias for /thinking' },
  { name: 'mouse', description: 'Opt into direct transcript clicks or restore native scroll and selection', argumentHint: '[on|off]' },
  { name: 'status', description: 'Show session, model, workspace, permissions, and connection' },
  { name: 'copy', description: 'Copy the last Kun response' },
  { name: 'export', description: 'Export the active session as Markdown', argumentHint: '[path]' },
  { name: 'details', description: 'Expand or collapse tool details' },
  { name: 'permission', description: 'Choose approval and sandbox policies' },
  { name: 'undo', description: 'Undo the last user turn in a preserved branch' },
  { name: 'redo', description: 'Move to the next preserved branch when available' },
  { name: 'init', description: 'Analyze the project and create or update AGENTS.md', argumentHint: '[guidance]' },
  { name: 'import', description: 'Import instruction context from other coding agents into AGENTS.md', argumentHint: '[tools] [--global] [--workspace] [--dry-run]' },
  { name: 'mcp', description: 'Add, edit, remove, reconnect, or authorize shared MCP servers', argumentHint: '[add|edit|enable|disable|reconnect|delete|authorize|reset]' },
  { name: 'timeline', description: 'Browse turns and fork at a turn', argumentHint: '[search]' },
  { name: 'jump', description: 'Jump to a numbered or matching turn', argumentHint: '[target]' },
  { name: 'subagents', description: 'Browse, open, background, abort, retry, or steer delegated child sessions', argumentHint: '[background|abort|retry|steer] <child-id>' },
  { name: 'tasks', description: 'View or edit persisted plan tasks', argumentHint: '[add|edit|start|done|pending|delete|move|clear]' },
  { name: 'attach', description: 'Attach a local file to the next message', argumentHint: '<path>|list|remove <n>|clear' },
  { name: 'paste', description: 'Paste an image directly from the system clipboard' },
  { name: 'memory', description: 'View or manage persistent memory', argumentHint: '[add|edit|enable|disable|delete]' },
  { name: 'shells', description: 'Inspect or stop background shell sessions', argumentHint: '[open|stop] <session-id>' },
  { name: 'extensions', description: 'Inspect, install, configure, reload, or remove Kun extensions and jobs', argumentHint: '[jobs|cancel-job|inspect|install|dev|index|enable|disable|rollback|reload|retry|remove]' },
  { name: 'plugins', description: 'Alias for /extensions' },
  { name: 'theme', description: 'Cycle or select the terminal theme', argumentHint: '[kun|ocean|mono]' },
  { name: 'share', description: 'Create a local portable Markdown share snapshot' },
  { name: 'unshare', description: 'Remove the local share snapshot for this session' },
  { name: 'console', description: 'Show recent shared-runtime log output' },
  { name: 'diff', description: 'Inspect the current workspace Git diff' },
  { name: 'terminal', description: 'Open an interactive shell and return to Kun on exit' },
  { name: 'update', description: 'Check or install the shared stable Kun release', argumentHint: '[yes]' },
  { name: 'plan', description: 'Enter plan mode for the next turn', argumentHint: '[status|tasks|off]' },
  { name: 'graph', description: 'Start a Graph requirement, inspect its run, or return to Direct', argumentHint: '[status|off|requirement]' },
  { name: 'agent', description: 'Enter normal agent mode' },
  { name: 'goal', description: 'View or manage the persistent goal', argumentHint: '[objective|pause|resume|clear]' },
  { name: 'skills', description: 'Browse workspace-visible skills', argumentHint: '[search]' },
  { name: 'editor', description: 'Edit the composer in VISUAL or EDITOR', argumentHint: '[draft]' },
  { name: 'add-dir', description: 'Add a persisted workspace root', argumentHint: '<path>' },
  { name: 'btw', description: 'Ask a question in a side session', argumentHint: '<question>' },
  { name: 'context', description: 'Show token and context usage' },
  { name: 'capabilities', description: 'Audit runtime capabilities and show how to enable unavailable ones' },
  { name: 'queue', description: 'View or manage queued steer messages', argumentHint: '[delete|move|edit|clear]' },
  { name: 'help', description: 'Show TUI help' },
  { name: 'quit', description: 'Exit the TUI' },
  { name: 'q', description: 'Alias for /quit' }
]

/**
 * Semantic actions shared by the command palette, help, leader hints, and key
 * dispatcher. Slash autocomplete includes the aliases above, while every
 * executable product action has one canonical entry here.
 */
export const TUI_COMMAND_DEFINITIONS: readonly TuiCommandDefinition[] = [
  { id: 'command_list', title: 'Open command palette', category: 'Global', keyAction: 'command_list', available: true },
  { id: 'sessions', title: 'Switch session', category: 'Session', slash: 'sessions', keyAction: 'session_list', available: true },
  { id: 'new', title: 'New session', category: 'Session', slash: 'new', keyAction: 'session_new', available: true },
  { id: 'open', title: 'Open session by ID', category: 'Session', slash: 'open', argumentRequired: true, available: true },
  { id: 'timeline', title: 'Open timeline', category: 'Session', slash: 'timeline', keyAction: 'session_timeline', available: true },
  { id: 'jump', title: 'Jump to a turn', category: 'Session', slash: 'jump', available: true },
  { id: 'rename', title: 'Rename session', category: 'Session', slash: 'rename', keyAction: 'session_rename', argumentRequired: true, available: true },
  { id: 'archive', title: 'Archive session', category: 'Session', slash: 'archive', available: true },
  { id: 'archives', title: 'Browse archived sessions', category: 'Session', slash: 'archives', available: true },
  { id: 'fork', title: 'Fork session', category: 'Session', slash: 'fork', available: true },
  { id: 'compact', title: 'Compact session', category: 'Session', slash: 'compact', keyAction: 'session_compact', available: true },
  { id: 'export', title: 'Export Markdown', category: 'Session', slash: 'export', keyAction: 'session_export', available: true },
  { id: 'status', title: 'Show status', category: 'Session', slash: 'status', keyAction: 'session_status', available: true },
  { id: 'copy', title: 'Copy last Kun response', category: 'Session', slash: 'copy', keyAction: 'messages_copy', available: true },
  { id: 'undo', title: 'Undo in a safe branch', category: 'Session', slash: 'undo', keyAction: 'session_undo', available: true },
  { id: 'redo', title: 'Redo to preserved branch', category: 'Session', slash: 'redo', keyAction: 'session_redo', available: true },
  { id: 'connect', title: 'Connect model provider', category: 'Model', slash: 'connect', available: true },
  { id: 'usage', title: 'Show Kun usage', category: 'Session', slash: 'usage', available: true },
  { id: 'quota', title: 'Show provider quota', category: 'Model', slash: 'quota', available: true },
  { id: 'model', title: 'Select model', category: 'Model', slash: 'model', keyAction: 'model_list', available: true },
  { id: 'variants', title: 'Select reasoning effort', category: 'Model', slash: 'variants', keyAction: 'variant_cycle', available: true },
  { id: 'thinking', title: 'Expand or collapse Thinking', category: 'Display', slash: 'thinking', keyAction: 'thinking_toggle', available: true },
  { id: 'mouse', title: 'Toggle mouse clicks / text selection', category: 'Display', slash: 'mouse', keyAction: 'pointer_mode_toggle', available: true },
  { id: 'details', title: 'Toggle tool details', category: 'Display', slash: 'details', keyAction: 'tool_details_toggle', available: true },
  { id: 'subagent-background', title: 'Move active subagent to background', category: 'Session', keyAction: 'subagent_detach', available: true },
  { id: 'permission', title: 'Change permissions', category: 'Session', slash: 'permission', available: true },
  { id: 'mode', title: 'Choose Agent, Plan, or Goal mode', category: 'Session', keyAction: 'agent_list', available: true },
  { id: 'plan', title: 'Enter Plan mode', category: 'Session', slash: 'plan', available: true },
  { id: 'graph', title: 'Open Graph board', category: 'Session', slash: 'graph', available: true },
  { id: 'agent', title: 'Enter Agent mode', category: 'Session', slash: 'agent', available: true },
  { id: 'subagents', title: 'Manage subagent sessions', category: 'Session', slash: 'subagents', available: true },
  { id: 'tasks', title: 'Manage plan tasks', category: 'Session', slash: 'tasks', available: true },
  { id: 'attach', title: 'Attach file', category: 'Session', slash: 'attach', available: true },
  { id: 'paste', title: 'Paste clipboard image', category: 'Session', slash: 'paste', keyAction: 'input_paste', available: true },
  { id: 'memory', title: 'Manage memory', category: 'Workspace', slash: 'memory', available: true },
  { id: 'shells', title: 'Manage background shells', category: 'Session', slash: 'shells', available: true },
  { id: 'extensions', title: 'Manage extensions', category: 'Workspace', slash: 'extensions', available: true },
  { id: 'theme', title: 'Choose theme', category: 'Display', slash: 'theme', keyAction: 'theme_list', available: true },
  { id: 'share', title: 'Create local share snapshot', category: 'Session', slash: 'share', keyAction: 'session_share', available: true },
  { id: 'unshare', title: 'Remove local share snapshot', category: 'Session', slash: 'unshare', keyAction: 'session_unshare', available: true },
  { id: 'console', title: 'Show runtime console', category: 'Workspace', slash: 'console', keyAction: 'console_toggle', available: true },
  { id: 'diff', title: 'Show workspace diff', category: 'Workspace', slash: 'diff', keyAction: 'diff_toggle', available: true },
  { id: 'terminal', title: 'Open interactive terminal', category: 'Workspace', slash: 'terminal', keyAction: 'terminal_toggle', available: true },
  { id: 'update', title: 'Update standalone Kun TUI', category: 'Global', slash: 'update', available: true },
  { id: 'goal', title: 'Manage persistent goal', category: 'Session', slash: 'goal', available: true },
  { id: 'queue', title: 'Show queued guidance', category: 'Session', slash: 'queue', available: true },
  { id: 'skills', title: 'Browse skills', category: 'Workspace', slash: 'skills', available: true },
  { id: 'mcp', title: 'Show MCP status', category: 'Workspace', slash: 'mcp', available: true },
  { id: 'init', title: 'Initialize workspace instructions', category: 'Workspace', slash: 'init', available: true },
  { id: 'import', title: 'Import agent context', category: 'Workspace', slash: 'import', available: true },
  { id: 'editor', title: 'Open external editor', category: 'Workspace', slash: 'editor', keyAction: 'input_editor', available: true },
  { id: 'steer', title: 'Steer the running turn', category: 'Session', keyAction: 'input_steer', available: true },
  { id: 'add-dir', title: 'Add workspace directory', category: 'Workspace', slash: 'add-dir', argumentRequired: true, available: true },
  { id: 'btw', title: 'Ask a side question', category: 'Session', slash: 'btw', argumentRequired: true, available: true },
  { id: 'context', title: 'Show token context', category: 'Session', slash: 'context', available: true },
  { id: 'capabilities', title: 'Audit runtime capabilities', category: 'Workspace', slash: 'capabilities', available: true },
  { id: 'help', title: 'Open help', category: 'Global', slash: 'help', available: true },
  { id: 'quit', title: 'Exit TUI', category: 'Global', slash: 'quit', keyAction: 'app_exit', available: true }
]

export function parseTuiCommand(text: string): TuiCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const space = trimmed.indexOf(' ')
  const name = (space < 0 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase()
  const rest = space < 0 ? '' : trimmed.slice(space + 1).trim()
  switch (name) {
    case 'help': return { kind: 'help' }
    case 'threads':
    case 'sessions':
    case 'search': return { kind: 'threads', ...(rest ? { search: rest } : {}) }
    case 'resume':
    case 'continue': return { kind: 'resume', ...(rest ? { search: rest } : {}) }
    case 'clear': return { kind: 'clear' }
    case 'new': return { kind: 'new', ...(rest ? { title: rest } : {}) }
    case 'open': return rest ? { kind: 'open', threadId: rest } : { kind: 'command-usage', usage: '/open <session-id>' }
    case 'title':
    case 'rename': return rest ? { kind: 'rename', title: rest } : { kind: 'command-usage', usage: '/rename <title>' }
    case 'archive': return { kind: 'archive' }
    case 'archives': return { kind: 'archives', ...(rest ? { search: rest } : {}) }
    case 'fork': return { kind: 'fork', ...(rest ? { title: rest } : {}) }
    case 'summarize':
    case 'compact': return { kind: 'compact' }
    case 'provider':
      return rest === 'usage' || rest === 'quota'
        ? { kind: 'quota' }
        : { kind: 'connect' }
    case 'connect': return { kind: 'connect' }
    case 'usage': return { kind: 'usage-report' }
    case 'quota': return { kind: 'quota' }
    case 'models':
    case 'model': return { kind: 'model' }
    case 'thinking':
    case 'reasoning': return { kind: 'reasoning' }
    case 'mouse': return { kind: 'mouse', ...(rest ? { action: rest } : {}) }
    case 'variants': return { kind: 'variants' }
    case 'status': return { kind: 'status' }
    case 'copy': return { kind: 'copy' }
    case 'export': return { kind: 'export', ...(rest ? { path: rest } : {}) }
    case 'details': return { kind: 'details' }
    case 'permission':
    case 'permissions': return { kind: 'permission' }
    case 'undo': return { kind: 'undo' }
    case 'redo': return { kind: 'redo' }
    case 'init': return { kind: 'init', ...(rest ? { instructions: rest } : {}) }
    case 'import': return { kind: 'import', ...(rest ? { args: rest } : {}) }
    case 'mcp': return { kind: 'mcp', ...(rest ? { action: rest } : {}) }
    case 'timeline': return { kind: 'timeline', ...(rest ? { query: rest } : {}) }
    case 'jump': return { kind: 'jump', ...(rest ? { target: rest } : {}) }
    case 'subagents': return { kind: 'subagents', ...(rest ? { action: rest } : {}) }
    case 'tasks':
    case 'todo':
    case 'todos': return { kind: 'tasks', ...(rest ? { action: rest } : {}) }
    case 'attach': return { kind: 'attach', ...(rest ? { path: rest } : {}) }
    case 'paste': return { kind: 'paste' }
    case 'memory':
    case 'memories': return { kind: 'memory', ...(rest ? { action: rest } : {}) }
    case 'shells':
    case 'jobs': return { kind: 'shells', ...(rest ? { action: rest } : {}) }
    case 'extensions':
    case 'plugins': return { kind: 'extensions', ...(rest ? { action: rest } : {}) }
    case 'theme': return { kind: 'theme', ...(rest ? { name: rest } : {}) }
    case 'share': return { kind: 'share' }
    case 'unshare': return { kind: 'unshare' }
    case 'console': return { kind: 'console' }
    case 'diff': return { kind: 'diff' }
    case 'terminal': return { kind: 'terminal' }
    case 'update': return { kind: 'update', confirm: rest.toLowerCase() === 'yes' }
    case 'plan': return { kind: 'plan', ...(rest ? { action: rest } : {}) }
    case 'graph': {
      if (!rest) return { kind: 'graph' }
      const action = rest.toLowerCase()
      return GRAPH_COMMAND_ACTIONS.has(action)
        ? { kind: 'graph', action }
        : { kind: 'graph', prompt: rest }
    }
    case 'agent': return { kind: 'agent' }
    case 'goal': return { kind: 'goal', ...(rest ? { action: rest } : {}) }
    case 'skills': return { kind: 'skills', ...(rest ? { query: rest } : {}) }
    case 'editor': return { kind: 'editor', ...(rest ? { initial: rest } : {}) }
    case 'add-dir': return rest
      ? { kind: 'add-dir', path: rest }
      : { kind: 'command-usage', usage: '/add-dir <path>' }
    case 'btw': return rest
      ? { kind: 'btw', question: rest }
      : { kind: 'command-usage', usage: '/btw <question>' }
    case 'context': return { kind: 'context' }
    case 'capabilities': return { kind: 'capabilities' }
    case 'queue': return { kind: 'queue', ...(rest ? { action: rest } : {}) }
    case 'q':
    case 'exit':
    case 'quit': return { kind: 'quit' }
    default: {
      if (name.startsWith('skill:')) {
        const skillName = name.slice('skill:'.length).trim()
        return skillName
          ? { kind: 'skill', name: skillName, ...(rest ? { prompt: rest } : {}) }
          : { kind: 'command-usage', usage: '/skill:<name> [prompt]' }
      }
      return { kind: 'unknown', name }
    }
  }
}

const GRAPH_COMMAND_ACTIONS = new Set([
  'status',
  'list',
  'off',
  'direct',
  'agent',
  'on',
  'start'
])
