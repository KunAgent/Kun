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
    expect(servers).toEqual(['python', 'typescript'])
    expect(getLanguageServer('typescript')?.displayName).toBe('TypeScript/JavaScript')
    expect(getLanguageServer('python')?.displayName).toBe('Python')
  })

  it('maps TypeScript and Python files to the expected servers', () => {
    expect(findLanguageServerForFile('/workspace/src/app.tsx')?.key).toBe('typescript')
    expect(findLanguageServerForFile('/workspace/src/app.py')?.key).toBe('python')
    expect(findLanguageServerForFile('/workspace/src/app.txt')).toBeUndefined()
  })

  it('derives document language ids from the matched server', () => {
    expect(languageIdForFile('/workspace/src/app.ts')).toBe('typescript')
    expect(languageIdForFile('/workspace/src/app.tsx')).toBe('typescriptreact')
    expect(languageIdForFile('/workspace/src/app.jsx')).toBe('javascriptreact')
    expect(languageIdForFile('/workspace/src/app.pyi')).toBe('python')
    expect(languageIdForFile('/workspace/src/app.txt')).toBeNull()
  })
})
