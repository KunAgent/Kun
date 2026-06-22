import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

const SERVER_PROBE_TIMEOUT = 3_000

export type LspServerCommand = {
  command: string
  args: string[]
}

export interface LanguageServerDef {
  key: string
  displayName: string
  extensions: string[]
  installHint: string
  resolveCommand: (workspaceRoot: string) => Promise<LspServerCommand | null>
  languageIdForFile: (filePath: string) => string
}

const registry = new Map<string, LanguageServerDef>()

function normalizeExtension(filePath: string): string {
  return filePath.toLowerCase()
}

function registerDefaultLanguageServers(): void {
  if (!registry.has('typescript')) {
    registerLanguageServer({
      key: 'typescript',
      displayName: 'TypeScript/JavaScript',
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'],
      installHint: 'Install with: npm install -g typescript-language-server typescript',
      resolveCommand: async (workspaceRoot) => {
        const localPath = join(workspaceRoot, 'node_modules', '.bin', 'typescript-language-server')
        try {
          await access(localPath)
          return { command: localPath, args: ['--stdio'] }
        } catch {
          // fall through to PATH lookup
        }
        const found = await probeServerBinary('typescript-language-server')
        return found ? { command: 'typescript-language-server', args: ['--stdio'] } : null
      },
      languageIdForFile: (filePath) => {
        const normalized = normalizeExtension(filePath)
        if (normalized.endsWith('.tsx')) return 'typescriptreact'
        if (normalized.endsWith('.jsx')) return 'javascriptreact'
        if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
          return 'javascript'
        }
        return 'typescript'
      }
    })
  }

  if (!registry.has('python')) {
    registerLanguageServer({
      key: 'python',
      displayName: 'Python',
      extensions: ['.py', '.pyi'],
      installHint: 'Install one of: pip install basedpyright, npm install -g pyright, or pip install python-lsp-server',
      resolveCommand: async () => {
        const candidates: Array<{ binary: string; args: string[] }> = [
          { binary: 'basedpyright-langserver', args: ['--stdio'] },
          { binary: 'pyright-langserver', args: ['--stdio'] },
          { binary: 'pylsp', args: [] }
        ]
        for (const candidate of candidates) {
          const found = await probeServerBinary(candidate.binary)
          if (found) {
            return { command: candidate.binary, args: candidate.args }
          }
        }
        return null
      },
      languageIdForFile: () => 'python'
    })
  }
}

export function registerLanguageServer(def: LanguageServerDef): void {
  registry.set(def.key, def)
}

export function getLanguageServer(key: string): LanguageServerDef | undefined {
  registerDefaultLanguageServers()
  return registry.get(key)
}

export function listLanguageServers(): LanguageServerDef[] {
  registerDefaultLanguageServers()
  return [...registry.values()]
}

export function findLanguageServerForFile(filePath: string): LanguageServerDef | undefined {
  registerDefaultLanguageServers()
  const normalized = normalizeExtension(filePath)
  return [...registry.values()].find((def) => def.extensions.some((ext) => normalized.endsWith(ext)))
}

export function languageIdForFile(filePath: string): string | null {
  const server = findLanguageServerForFile(filePath)
  return server ? server.languageIdForFile(filePath) : null
}

export async function resolveServerCommand(
  workspaceRoot: string,
  serverKey: string
): Promise<LspServerCommand | null> {
  const server = getLanguageServer(serverKey)
  if (!server) return null
  return server.resolveCommand(workspaceRoot)
}

export async function probeServerBinary(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'where' : 'which'
    const child = spawn(command, [binary], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: SERVER_PROBE_TIMEOUT,
      windowsHide: true
    })
    let stdout = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      resolve(code === 0 && stdout.trim() ? stdout.trim().split(/\r?\n/)[0] ?? null : null)
    })
  })
}

registerDefaultLanguageServers()
