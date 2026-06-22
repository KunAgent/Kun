import { describe, expect, it } from 'vitest'
import {
  findLanguageServerForFile,
  getLanguageServer,
  languageIdForFile,
  listLanguageServers
} from './lsp-servers.js'

describe('lsp server registry', () => {
  it('registers the default language servers', () => {
    const servers = listLanguageServers().map((server) => server.key).sort()
    expect(servers).toEqual(['clangd', 'go', 'json', 'python', 'rust', 'typescript', 'yaml'])
    expect(getLanguageServer('typescript')?.displayName).toBe('TypeScript/JavaScript')
    expect(getLanguageServer('python')?.displayName).toBe('Python')
    expect(getLanguageServer('rust')?.displayName).toBe('Rust')
    expect(getLanguageServer('go')?.displayName).toBe('Go')
    expect(getLanguageServer('clangd')?.displayName).toBe('C/C++')
    expect(getLanguageServer('json')?.displayName).toBe('JSON')
    expect(getLanguageServer('yaml')?.displayName).toBe('YAML')
  })

  it('maps common source and config files to the expected servers', () => {
    expect(findLanguageServerForFile('/workspace/src/app.tsx')?.key).toBe('typescript')
    expect(findLanguageServerForFile('/workspace/src/app.py')?.key).toBe('python')
    expect(findLanguageServerForFile('/workspace/src/main.rs')?.key).toBe('rust')
    expect(findLanguageServerForFile('/workspace/src/main.go')?.key).toBe('go')
    expect(findLanguageServerForFile('/workspace/src/main.cpp')?.key).toBe('clangd')
    expect(findLanguageServerForFile('/workspace/src/main.h')?.key).toBe('clangd')
    expect(findLanguageServerForFile('/workspace/package.json')?.key).toBe('json')
    expect(findLanguageServerForFile('/workspace/tsconfig.jsonc')?.key).toBe('json')
    expect(findLanguageServerForFile('/workspace/.github/workflows/ci.yml')?.key).toBe('yaml')
    expect(findLanguageServerForFile('/workspace/src/app.txt')).toBeUndefined()
  })

  it('derives document language ids from the matched server', () => {
    expect(languageIdForFile('/workspace/src/app.ts')).toBe('typescript')
    expect(languageIdForFile('/workspace/src/app.tsx')).toBe('typescriptreact')
    expect(languageIdForFile('/workspace/src/app.jsx')).toBe('javascriptreact')
    expect(languageIdForFile('/workspace/src/app.pyi')).toBe('python')
    expect(languageIdForFile('/workspace/src/main.rs')).toBe('rust')
    expect(languageIdForFile('/workspace/src/main.go')).toBe('go')
    expect(languageIdForFile('/workspace/src/main.c')).toBe('c')
    expect(languageIdForFile('/workspace/src/main.h')).toBe('cpp')
    expect(languageIdForFile('/workspace/src/main.hpp')).toBe('cpp')
    expect(languageIdForFile('/workspace/package.json')).toBe('json')
    expect(languageIdForFile('/workspace/tsconfig.jsonc')).toBe('jsonc')
    expect(languageIdForFile('/workspace/config.yaml')).toBe('yaml')
    expect(languageIdForFile('/workspace/src/app.txt')).toBeNull()
  })
})
