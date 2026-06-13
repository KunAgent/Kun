const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.astro',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.dart',
  '.env',
  '.fish',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.lock',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])

const TEXT_PREVIEW_NAMES = new Set([
  '.env',
  '.gitignore',
  'dockerfile',
  'makefile',
  'package-lock.json',
  'pnpm-lock.yaml',
  'readme'
])

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? path
}

function extension(path: string): string {
  const name = basename(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

export function isWorkspaceTextPreviewPath(path: string): boolean {
  const name = basename(path).toLowerCase()
  if (TEXT_PREVIEW_NAMES.has(name)) return true
  const ext = extension(path)
  return Boolean(ext && TEXT_PREVIEW_EXTENSIONS.has(ext))
}
