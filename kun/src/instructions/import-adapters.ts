import type { SourceAdapter, SourceToolId } from './instruction-import.js'

/**
 * Source adapters for importing other coding agents' instruction files into
 * Kun `AGENTS.md`. File locations follow the `rulesync` project as a reference.
 * Adapters are added per delivery round; this module now ships all ten tools.
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

export const copilotAdapter: SourceAdapter = {
  tool: 'copilot',
  label: 'GitHub Copilot',
  workspace: [
    { kind: '.github/copilot-instructions.md', relFile: '.github/copilot-instructions.md' },
    { kind: '.github/instructions', relDir: '.github/instructions', exts: ['.instructions.md', '.md'], stripFrontmatter: true }
  ],
  global: []
}

export const windsurfAdapter: SourceAdapter = {
  tool: 'windsurf',
  label: 'Windsurf',
  workspace: [
    { kind: '.windsurf/rules', relDir: '.windsurf/rules', exts: ['.md'], stripFrontmatter: true },
    { kind: '.windsurfrules', relFile: '.windsurfrules' }
  ],
  global: []
}

export const clineAdapter: SourceAdapter = {
  tool: 'cline',
  label: 'Cline',
  // `.clinerules` may be a single file or a directory of markdown rules.
  workspace: [
    { kind: '.clinerules', relFile: '.clinerules' },
    { kind: '.clinerules/', relDir: '.clinerules', exts: ['.md'] }
  ],
  global: []
}

export const zedAdapter: SourceAdapter = {
  tool: 'zed',
  label: 'Zed',
  workspace: [{ kind: '.rules', relFile: '.rules' }],
  // Zed's global lives under the platform config dir; list both so the absent one is skipped.
  global: [
    { kind: '~/.config/zed/AGENTS.md', relFile: '.config/zed/AGENTS.md' },
    { kind: 'AppData/Roaming/Zed/AGENTS.md', relFile: 'AppData/Roaming/Zed/AGENTS.md' }
  ]
}

export const opencodeAdapter: SourceAdapter = {
  tool: 'opencode',
  label: 'OpenCode',
  // Workspace AGENTS.md resolves to the Kun target and is reported as an identity skip.
  workspace: [
    { kind: 'AGENTS.md', relFile: 'AGENTS.md' },
    { kind: '.opencode/memories', relDir: '.opencode/memories', exts: ['.md'] }
  ],
  global: [
    { kind: '~/.config/opencode/AGENTS.md', relFile: '.config/opencode/AGENTS.md' },
    { kind: '~/.config/opencode/memories', relDir: '.config/opencode/memories', exts: ['.md'] }
  ]
}

export const kiroAdapter: SourceAdapter = {
  tool: 'kiro',
  label: 'Kiro',
  workspace: [{ kind: '.kiro/steering', relDir: '.kiro/steering', exts: ['.md'], stripFrontmatter: true }],
  global: [{ kind: '~/.kiro/steering', relDir: '.kiro/steering', exts: ['.md'], stripFrontmatter: true }]
}

export const IMPORT_ADAPTERS: SourceAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  cursorAdapter,
  geminiAdapter,
  copilotAdapter,
  windsurfAdapter,
  clineAdapter,
  zedAdapter,
  opencodeAdapter,
  kiroAdapter
]

export function adapterById(id: string): SourceAdapter | undefined {
  return IMPORT_ADAPTERS.find((adapter) => adapter.tool === id)
}

export function supportedToolIds(): SourceToolId[] {
  return IMPORT_ADAPTERS.map((adapter) => adapter.tool)
}
