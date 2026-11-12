import type { WorkspaceEntry } from './workspace-file'
import { isLatexFilePath } from './latex-project'

export const WRITE_TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text'
])

export const WRITE_CODE_FILE_EXTENSIONS = new Set([
  '.astro',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.cts',
  '.csv',
  '.cxx',
  '.dart',
  '.diff',
  '.env',
  '.fish',
  '.go',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.kt',
  '.kts',
  '.less',
  '.lock',
  '.log',
  '.lua',
  '.mjs',
  '.mts',
  '.patch',
  '.php',
  '.ps1',
  '.psd1',
  '.psm1',
  '.py',
  '.pyi',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])

export const WRITE_CODE_FILE_NAMES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env',
  '.eslintignore',
  '.eslintrc',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc',
  'dockerfile',
  'gemfile',
  'justfile',
  'makefile',
  'procfile',
  'rakefile'
])

export const WRITE_IMAGE_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.ico'
])

export const WRITE_PDF_FILE_EXTENSIONS = new Set([
  '.pdf'
])

export const WRITE_OFFICE_FILE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx'
])

export function isWriteTextFileExtension(ext: string): boolean {
  return WRITE_TEXT_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWriteCodeFileExtension(ext: string): boolean {
  return WRITE_CODE_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWriteImageFileExtension(ext: string): boolean {
  return WRITE_IMAGE_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWritePdfFileExtension(ext: string): boolean {
  return WRITE_PDF_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWriteOfficeFileExtension(ext: string): boolean {
  return WRITE_OFFICE_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

function extensionFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const dot = normalized.lastIndexOf('.')
  if (dot < 0) return ''
  const slash = normalized.lastIndexOf('/')
  if (dot < slash) return ''
  return normalized.slice(dot)
}

function basenameFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  return normalized.slice(slash + 1)
}

export function isWriteCodeFileName(name: string): boolean {
  const normalized = basenameFromPath(name.trim()).toLowerCase()
  return WRITE_CODE_FILE_NAMES.has(normalized) ||
    normalized.startsWith('.env.') ||
    normalized.startsWith('dockerfile.') ||
    isWriteCodeFileExtension(extensionFromPath(normalized))
}

export function isWriteTextFilePath(path: string): boolean {
  return isWriteTextFileExtension(extensionFromPath(path))
}

export function isWriteCodeFilePath(path: string): boolean {
  return isWriteCodeFileName(path)
}

export function isWriteImageFilePath(path: string): boolean {
  return isWriteImageFileExtension(extensionFromPath(path))
}

export function isWritePdfFilePath(path: string): boolean {
  return isWritePdfFileExtension(extensionFromPath(path))
}

export function isWriteOfficeFilePath(path: string): boolean {
  return isWriteOfficeFileExtension(extensionFromPath(path))
}

export function isWriteWorkspaceFilePath(path: string): boolean {
  return isLatexFilePath(path) || isWriteTextFilePath(path) || isWriteCodeFilePath(path) || isWriteImageFilePath(path) ||
    isWritePdfFilePath(path) || isWriteOfficeFilePath(path)
}

export function isWriteWorkspaceEntry(entry: WorkspaceEntry): boolean {
  return entry.type === 'directory' ||
    isLatexFilePath(entry.name) ||
    isWriteTextFileExtension(entry.ext) ||
    isWriteCodeFileExtension(entry.ext) ||
    isWriteCodeFileName(entry.name) ||
    isWriteImageFileExtension(entry.ext) ||
    isWritePdfFileExtension(entry.ext) ||
    isWriteOfficeFileExtension(entry.ext)
}
