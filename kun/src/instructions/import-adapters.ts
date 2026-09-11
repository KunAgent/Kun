import type { SourceAdapter, SourceToolId } from './instruction-import.js'

/**
 * Source adapters for importing other coding agents' instruction files into
 * Kun `AGENTS.md`. File locations follow the `rulesync` project as a reference.
 * Adapters are added per delivery round; this module currently ships rounds 1-2.
 */

export const claudeCodeAdapter: SourceAdapter = {
  tool: 'claude-code',
  label: 'Claude Code',
  workspace: [
    { kind: 'CLAUDE.md', relFile: 'CLAUDE.md', resolveImports: true },
    { kind: 'CLAUDE.local.md', relFile: 'CLAUDE.local.md', resolveImports: true },
    { kind: '.claude/rules', relDir: '.claude/rules', exts: ['.md'] }
  ],
  global: [{ kind: '~/.claude/CLAUDE.md', relFile: '.claude/CLAUDE.md', resolveImports: true }]
}

export const codexAdapter: SourceAdapter = {
  tool: 'codex',
  label: 'Codex',
  // Workspace AGENTS.md is Kun's own format and resolves to the import target,
  // so the engine reports it as an identity skip rather than importing it.
  workspace: [
    { kind: 'AGENTS.md', relFile: 'AGENTS.md' },
    { kind: 'AGENTS.override.md', relFile: 'AGENTS.override.md' }
  ],
  global: [{ kind: '~/.codex/AGENTS.md', relFile: '.codex/AGENTS.md' }]
}

export const cursorAdapter: SourceAdapter = {
  tool: 'cursor',
  label: 'Cursor',
  workspace: [
    { kind: '.cursor/rules', relDir: '.cursor/rules', exts: ['.mdc', '.md'], stripFrontmatter: true },
    { kind: '.cursorrules', relFile: '.cursorrules' }
  ],
  global: []
}

export const geminiAdapter: SourceAdapter = {
  tool: 'gemini',
  label: 'Gemini CLI',
  workspace: [{ kind: 'GEMINI.md', relFile: 'GEMINI.md' }],
  global: [{ kind: '~/.gemini/GEMINI.md', relFile: '.gemini/GEMINI.md' }]
}

export const IMPORT_ADAPTERS: SourceAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  cursorAdapter,
  geminiAdapter
]

export function adapterById(id: string): SourceAdapter | undefined {
  return IMPORT_ADAPTERS.find((adapter) => adapter.tool === id)
}

export function supportedToolIds(): SourceToolId[] {
  return IMPORT_ADAPTERS.map((adapter) => adapter.tool)
}
