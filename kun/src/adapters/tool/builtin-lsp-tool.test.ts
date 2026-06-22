import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  acquireLspSession: vi.fn(),
  lspOpenDocument: vi.fn(),
  lspCloseDocument: vi.fn(),
  lspGetDiagnostics: vi.fn(),
  releaseLspSession: vi.fn(),
  findLanguageServerForFile: vi.fn(),
  languageIdForFile: vi.fn(),
  listLanguageServers: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile
}))

vi.mock('./local-tool-host.js', () => ({
  LocalToolHost: {
    defineTool: (tool: unknown) => tool
  }
}))

vi.mock('./builtin-tool-utils.js', () => ({
  withToolBoundary: async (run: () => Promise<unknown>) => run(),
  resolveWorkspacePath: (inputPath: string) => ({
    workspaceRoot: '/workspace',
    absolutePath: `/workspace/${inputPath}`,
    relativePath: inputPath
  })
}))

vi.mock('./lsp-client.js', () => ({
  acquireLspSession: mocks.acquireLspSession,
  lspCloseDocument: mocks.lspCloseDocument,
  lspDefinition: vi.fn(),
  lspGetDiagnostics: mocks.lspGetDiagnostics,
  lspDocumentSymbol: vi.fn(),
  lspHover: vi.fn(),
  lspImplementation: vi.fn(),
  lspOpenDocument: mocks.lspOpenDocument,
  lspReferences: vi.fn(),
  releaseLspSession: mocks.releaseLspSession,
  lspWorkspaceSymbol: vi.fn()
}))

vi.mock('./lsp-servers.js', () => ({
  findLanguageServerForFile: mocks.findLanguageServerForFile,
  languageIdForFile: mocks.languageIdForFile,
  listLanguageServers: mocks.listLanguageServers
}))

import { createLspLocalTool } from './builtin-lsp-tool.js'

describe('builtin lsp tool diagnostics', () => {
  it('returns simplified best-effort diagnostics from the cache-backed operation', async () => {
    mocks.readFile.mockResolvedValue('const broken = true\n')
    mocks.findLanguageServerForFile.mockReturnValue({
      key: 'typescript',
      displayName: 'TypeScript/JavaScript',
      extensions: ['.ts']
    })
    mocks.languageIdForFile.mockReturnValue('typescript')
    mocks.acquireLspSession.mockResolvedValue({ session: true })
    mocks.lspGetDiagnostics.mockResolvedValue({
      diagnostics: [
        {
          message: 'Type error',
          severity: 1,
          source: 'ts',
          code: 2322,
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 10 }
          }
        }
      ],
      source: 'textDocument/diagnostic'
    })

    const tool = createLspLocalTool()
    const context = {
      workspace: '/workspace',
      threadId: 'thread_test',
      turnId: 'turn_test',
      approvalPolicy: 'auto' as const,
      abortSignal: new AbortController().signal,
      awaitApproval: vi.fn()
    }
    const result = await tool.execute(
      { operation: 'getDiagnostics', filePath: 'demo.ts' },
      context
    )

    expect(mocks.acquireLspSession).toHaveBeenCalledWith('/workspace', 'typescript')
    expect(mocks.lspOpenDocument).toHaveBeenCalledWith(
      { session: true },
      '/workspace/demo.ts',
      'const broken = true\n',
      'typescript'
    )
    expect(result).toEqual({
      output: {
        operation: 'getDiagnostics',
        result: [
          {
            message: 'Type error',
            severity: 1,
            source: 'ts',
            code: 2322,
            range: {
              start: { line: 3, character: 5 },
              end: { line: 3, character: 11 }
            }
          }
        ],
        bestEffort: true,
        source: 'textDocument/diagnostic'
      }
    })
    expect(mocks.lspCloseDocument).toHaveBeenCalledWith({ session: true }, '/workspace/demo.ts')
    expect(mocks.releaseLspSession).toHaveBeenCalledWith('/workspace', 'typescript')
  })
})
