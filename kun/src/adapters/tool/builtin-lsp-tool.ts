/**
 * `lsp` tool — exposes Language Server Protocol queries to the AI agent.
 *
 * Supports the configured language servers in lsp-servers.ts.
 * The matching server binary must be installed (locally or on PATH); if missing the
 * tool returns a helpful error instead of crashing.
 *
 * Operations: goToDefinition, findReferences, hover, documentSymbol,
 * workspaceSymbol, goToImplementation. All queries are read-only.
 *
 * Positions use 1-based line/character (as editors display them); the tool
 * converts to 0-based before sending to the LSP server.
 */

import { readFile } from 'node:fs/promises'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import {
  acquireLspSession,
  lspCloseDocument,
  lspDefinition,
  lspGetDiagnostics,
  lspDocumentSymbol,
  lspHover,
  lspImplementation,
  lspOpenDocument,
  lspReferences,
  releaseLspSession,
  lspWorkspaceSymbol,
  type LspSession
} from './lsp-client.js'
import {
  findLanguageServerForFile,
  languageIdForFile,
  listLanguageServers
} from './lsp-servers.js'

type LspOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'getDiagnostics'

const OPERATIONS: LspOperation[] = [
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'getDiagnostics'
]

const POSITION_REQUIRED: LspOperation[] = [
  'goToDefinition',
  'findReferences',
  'hover',
  'goToImplementation'
]

export function createLspLocalTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: 'lsp',
    description:
      'Query a language server for TypeScript/JavaScript, Python, Rust, Go, C/C++, JSON, and YAML. ' +
      'Supports: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, getDiagnostics. ' +
      'Positions are 1-based (line/character as shown in editors). ' +
      'Diagnostics are best-effort and use publishDiagnostics caches or pull diagnostics when supported. ' +
      'Requires a matching language server to be installed.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: OPERATIONS,
          description: 'The LSP operation to perform'
        },
        filePath: {
          type: 'string',
          description: 'Absolute or workspace-relative path to the source file'
        },
        line: {
          type: 'number',
          description: 'Line number (1-based). Required for position-based operations.'
        },
        character: {
          type: 'number',
          description: 'Character offset (1-based). Required for position-based operations.'
        },
        query: {
          type: 'string',
          description: 'Search query (used by workspaceSymbol)'
        }
      },
      required: ['operation', 'filePath'],
      additionalProperties: false
    },
    policy: 'auto',
    toolKind: 'tool_call',
    execute: async (args, context) =>
      withToolBoundary(async () => {
        const operation = String(args.operation ?? '') as LspOperation
        const rawPath = typeof args.filePath === 'string' ? args.filePath : ''
        if (!rawPath.trim()) {
          return { output: { error: 'filePath is required' }, isError: true }
        }
        if (!OPERATIONS.includes(operation)) {
          return { output: { error: `Unknown operation: ${operation}` }, isError: true }
        }

        const { absolutePath, workspaceRoot } = resolveWorkspacePath(rawPath, context)
        const server = findLanguageServerForFile(absolutePath)
        if (!server) {
          const supported = listLanguageServers()
            .map((item) => `${item.displayName} (${item.extensions.join(', ')})`)
            .join('; ')
          return {
            output: {
              error: `No language server is configured for file: ${absolutePath}`,
              supported
            },
            isError: true
          }
        }
        const documentLanguageId = languageIdForFile(absolutePath)
        if (!documentLanguageId) {
          return {
            output: { error: `Could not determine language id for file: ${absolutePath}` },
            isError: true
          }
        }

        const line = typeof args.line === 'number' ? args.line : 0
        const character = typeof args.character === 'number' ? args.character : 0
        if (POSITION_REQUIRED.includes(operation) && (line < 1 || character < 1)) {
          return {
            output: { error: `${operation} requires both line and character (1-based)` },
            isError: true
          }
        }

        // LSP uses 0-based positions.
        const lspLine = Math.max(0, line - 1)
        const lspChar = Math.max(0, character - 1)

        let session: LspSession
        try {
          session = await acquireLspSession(workspaceRoot, server.key)
        } catch (err) {
          return {
            output: {
              error: err instanceof Error ? err.message : String(err)
            },
            isError: true
          }
        }

        // For file-level operations, open the document first so the server has it in memory.
        const needsDocument = operation !== 'workspaceSymbol'
        if (needsDocument) {
          try {
            const content = await readFile(absolutePath, 'utf-8')
            await lspOpenDocument(session, absolutePath, content, documentLanguageId)
          } catch {
            return {
              output: { error: `Could not read file: ${absolutePath}` },
              isError: true
            }
          }
        }

        try {
          let result: unknown
          switch (operation) {
            case 'goToDefinition':
              result = await lspDefinition(session, absolutePath, lspLine, lspChar)
              break
            case 'findReferences':
              result = await lspReferences(session, absolutePath, lspLine, lspChar)
              break
            case 'hover':
              result = await lspHover(session, absolutePath, lspLine, lspChar)
              break
            case 'documentSymbol':
              result = await lspDocumentSymbol(session, absolutePath)
              break
            case 'workspaceSymbol':
              result = await lspWorkspaceSymbol(session, String(args.query ?? ''))
              break
            case 'goToImplementation':
              result = await lspImplementation(session, absolutePath, lspLine, lspChar)
              break
            case 'getDiagnostics': {
              const diagnostics = await lspGetDiagnostics(session, absolutePath)
              result = diagnostics.diagnostics
              return {
                output: {
                  operation,
                  result: simplifyResult(result),
                  bestEffort: true,
                  source: diagnostics.source
                }
              }
            }
            default:
              return { output: { error: `Unsupported operation: ${operation}` }, isError: true }
          }
          return {
            output: {
              operation,
              result: simplifyResult(result)
            }
          }
        } catch (err) {
          return {
            output: { error: err instanceof Error ? err.message : String(err) },
            isError: true
          }
        } finally {
          if (needsDocument) {
            try { await lspCloseDocument(session, absolutePath) } catch { /* ignore */ }
          }
          releaseLspSession(workspaceRoot, server.key)
        }
      })
  })
}

/**
 * Strip file:// URIs to plain paths and slim down verbose LSP types so the
 * output is compact enough to fit in the agent's context window.
 */
function simplifyResult(result: unknown): unknown {
  if (result === null || result === undefined) return null
  if (Array.isArray(result)) return result.map(simplifyLocation)
  return simplifyLocation(result)
}

function simplifyLocation(item: unknown): unknown {
  if (item === null || typeof item !== 'object') return item
  const obj = item as Record<string, unknown>
  // Location: { uri, range }
  if (typeof obj.uri === 'string') {
    return {
      path: uriToPath(obj.uri),
      range: simplifyRange(obj.range),
      ...(obj.name ? { name: obj.name } : {}),
      ...(obj.kind ? { kind: obj.kind } : {}),
      ...(obj.containerName ? { containerName: obj.containerName } : {})
    }
  }
  // Hover: { contents }
  if (obj.contents) {
    return { contents: simplifyHoverContents(obj.contents), range: simplifyRange(obj.range) }
  }
  // DocumentSymbol / SymbolInformation
  if (obj.name && (obj.kind !== undefined || obj.location !== undefined)) {
    return {
      name: obj.name,
      kind: symbolKindName(obj.kind),
      ...(obj.detail ? { detail: obj.detail } : {}),
      ...(obj.range ? { range: simplifyRange(obj.range) } : {}),
      ...(obj.selectionRange ? { selectionRange: simplifyRange(obj.selectionRange) } : {}),
      ...(obj.containerName ? { containerName: obj.containerName } : {}),
      ...(obj.location ? { path: uriToPath((obj.location as Record<string, unknown>).uri as string) } : {})
    }
  }
  if (obj.message && (obj.range !== undefined || obj.severity !== undefined || obj.source !== undefined)) {
    return {
      message: obj.message,
      ...(obj.severity !== undefined ? { severity: obj.severity } : {}),
      ...(obj.source ? { source: obj.source } : {}),
      ...(obj.code !== undefined ? { code: obj.code } : {}),
      ...(obj.range ? { range: simplifyRange(obj.range) } : {})
    }
  }
  return obj
}

function simplifyRange(range: unknown): unknown {
  if (!range || typeof range !== 'object') return range
  const r = range as Record<string, unknown>
  return {
    start: pos(r.start),
    end: pos(r.end)
  }
}

function pos(p: unknown): unknown {
  if (!p || typeof p !== 'object') return p
  const point = p as Record<string, unknown>
  // Convert back to 1-based for display.
  return {
    line: (typeof point.line === 'number' ? point.line : 0) + 1,
    character: (typeof point.character === 'number' ? point.character : 0) + 1
  }
}

function simplifyHoverContents(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents.map(simplifyHoverContents).join('\n\n')
  }
  if (contents && typeof contents === 'object') {
    const c = contents as Record<string, unknown>
    if (typeof c.value === 'string') return c.value
  }
  return String(contents)
}

function uriToPath(uri: unknown): string {
  if (typeof uri !== 'string') return ''
  try {
    return new URL(uri).pathname
  } catch {
    return uri
  }
}

const SYMBOL_KINDS: Record<number, string> = {
  1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
  6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
  11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant', 15: 'String',
  16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object', 20: 'Key',
  21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event', 25: 'Operator',
  26: 'TypeParameter'
}

function symbolKindName(kind: unknown): string {
  const k = typeof kind === 'number' ? kind : Number(kind)
  return SYMBOL_KINDS[k] ?? String(kind)
}
